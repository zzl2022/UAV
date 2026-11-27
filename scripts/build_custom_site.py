"""将带地理参考的建筑足迹、DEM 和可选影像转换为自定义区域。"""

import argparse
import codecs
from contextlib import closing
from datetime import datetime, timezone
from functools import lru_cache, partial
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import traceback
import unicodedata

import numpy as np
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
import rasterio
from rasterio.enums import ColorInterp
from rasterio.errors import RasterioError
from rasterio.warp import transform_bounds
from rasterio.windows import Window
import shapefile
from shapely import geometry, make_valid
from shapely.errors import GEOSException

from imagery import prepare_imagery
from prepare_data import dem_cell, dump, local_enu_point

TIFF = {'.tif', '.tiff'}
IMAGE = TIFF | {'.jpg', '.jpeg', '.png'}
MAX_TERRAIN_EDGE = 512


class SiteBuildError(ValueError):
    pass


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def one(files, label, root, required=False):
    if len(files) > 1:
        candidates = '、'.join(path.relative_to(root).as_posix() for path in files)
        raise SiteBuildError(f'找到 {len(files)} 个{label}候选，请只保留一个区域：{candidates}')
    if files:
        return files[0]
    if required:
        raise SiteBuildError(f'缺少{label}')
    return None


def file_header(path):
    with path.open('rb') as stream:
        return stream.read(8)


def check_raster_header(path):
    header = file_header(path)
    suffix = path.suffix.lower()
    if suffix in TIFF:
        valid = header[:4] in {b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+'}
    elif suffix == '.png':
        valid = header == b'\x89PNG\r\n\x1a\n'
    else:
        valid = header.startswith(b'\xff\xd8\xff')
    if not valid:
        raise SiteBuildError(f'栅格文件格式与扩展名不符：{path.name}')


def has_hint(path, root, hints):
    name = path.relative_to(root).as_posix().casefold()
    return any(hint in name for hint in hints)


def discover(root):
    if not root.is_dir() or linked(root):
        raise SiteBuildError('输入必须是普通文件夹')
    files = []
    for path in sorted(root.rglob('*')):
        if linked(path):
            raise SiteBuildError(f'不支持链接文件或文件夹：{path.name}')
        if path.is_file():
            files.append(path)
    shp = one([p for p in files if p.suffix.lower() == '.shp'], '.shp 建筑文件', root, True)
    siblings = {}
    for suffix in ('.dbf', '.prj', '.cpg'):
        matches = [p for p in files if p.parent == shp.parent and p.stem.casefold() == shp.stem.casefold()
                   and p.suffix.lower() == suffix]
        siblings[suffix] = one(matches, suffix + ' 建筑配套文件', root, suffix != '.cpg')
    tileset = one([p for p in files if p.name.casefold() == 'tileset.json'], '白模 tileset.json', root)

    rasters = [p for p in files if p.suffix.lower() in IMAGE]
    imagery_hint = lambda p: has_hint(p, root, ('影像', 'image', 'ortho'))
    tiffs = [p for p in rasters if p.suffix.lower() in TIFF]
    candidates = []
    for path in tiffs:
        if imagery_hint(path):
            continue
        if has_hint(path, root, ('dem',)):
            candidates.insert(0, path)
            continue
        check_raster_header(path)
        try:
            with rasterio.open(path) as raster:
                if raster.count == 1 and raster.colorinterp[0] != ColorInterp.palette:
                    candidates.append(path)
        except RasterioError as exc:
            raise SiteBuildError(f'无法读取 GeoTIFF：{path.name}') from exc
    dem = one(candidates, ' DEM GeoTIFF', root, True)
    image = one([p for p in rasters if p != dem], '影像底图', root)
    reference = None
    if image:
        reference = one([p for p in files if p.parent == image.parent
                         and p.name.casefold() == f'{image.stem}.json'.casefold()
                         and p != tileset], '影像定位文件', root)
    return shp, siblings['.dbf'], siblings['.prj'], siblings['.cpg'], dem, image, reference, tileset


def local_frame(tileset, bounds):
    to_ecef = Transformer.from_crs(4979, 4978, always_xy=True)
    west, south, east, north = bounds
    center = [(west + east) / 2, (south + north) / 2]
    if tileset:
        try:
            raw = json.loads(tileset.read_text(encoding='utf-8-sig'))['root']['transform']
            matrix = np.asarray(raw, dtype=float).reshape((4, 4), order='F')
            rotation, translation = matrix[:3, :3], matrix[:3, 3]
            if (not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1])
                    or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-7)
                    or not math.isclose(np.linalg.det(rotation), 1, abs_tol=1e-7)
                    or not 6_000_000 < np.linalg.norm(translation) < 7_000_000):
                raise ValueError('无效的局部变换矩阵')
            origin = list(Transformer.from_crs(4978, 4979, always_xy=True).transform(*translation))
        except (ValueError, KeyError, TypeError, OverflowError) as exc:
            raise SiteBuildError('tileset.json 的 root.transform 必须是有效的局部 ENU 到 ECEF 矩阵') from exc
        projection = '白模 root.transform 局部 ENU，米，场景轴为东／上／负北'
    else:
        origin = [*center, 0]
        lon, lat = map(math.radians, center)
        slon, clon, slat, clat = math.sin(lon), math.cos(lon), math.sin(lat), math.cos(lat)
        rotation = np.array([[-slon, -slat * clon, clat * clon],
                             [clon, -slat * slon, clat * slon],
                             [0, clat, slat]])
        translation = np.array(to_ecef.transform(*origin))
        matrix = np.eye(4)
        matrix[:3, :3], matrix[:3, 3] = rotation, translation
        projection = 'DEM 的 WGS84 边界中心为原点，局部 ENU，米，场景轴为东／上／负北'
    return center, origin, matrix.flatten(order='F').tolist(), projection, partial(
        local_enu_point, to_ecef=to_ecef, rotation=rotation, translation=translation)


def elevation_sampler(raster):
    to_dem = Transformer.from_crs(4326, raster.crs, always_xy=True)
    scale, offset = raster.scales[0], raster.offsets[0]

    @lru_cache(maxsize=64)
    def block(row, col):
        return raster.read(1, window=Window(col, row, 128, 128), masked=True)

    def sample(lon, lat):
        if not math.isfinite(lon) or not math.isfinite(lat):
            raise SiteBuildError('建筑足迹坐标无效')
        row, col = dem_cell(raster, to_dem, lon, lat)
        if not (0 <= row < raster.height and 0 <= col < raster.width):
            raise SiteBuildError('建筑足迹超出 DEM 范围')
        value = block(row // 128 * 128, col // 128 * 128)[row % 128, col % 128]
        if np.ma.is_masked(value) or not math.isfinite(value):
            raise SiteBuildError('建筑足迹遇到无效的 DEM 像元')
        return float(value) * scale + offset

    return sample


def polygon_parts(shape):
    if shape.geom_type == 'Polygon':
        if not shape.is_empty:
            yield shape
    elif shape.geom_type in {'MultiPolygon', 'GeometryCollection'}:
        for part in shape.geoms:
            yield from polygon_parts(part)


def read_buildings(shp, dbf, prj, cpg, raster, local):
    try:
        to_geo = Transformer.from_crs(CRS.from_wkt(prj.read_text(encoding='utf-8-sig')), 4326, always_xy=True)
    except (CRSError, UnicodeError) as exc:
        raise SiteBuildError(f'建筑 .prj 坐标系无效：{prj.name}') from exc
    try:
        encoding = cpg.read_text(encoding='utf-8-sig').strip() if cpg else 'utf-8'
        if encoding.isdigit():
            encoding = 'utf-8' if encoding == '65001' else f'cp{encoding}'
        codecs.lookup(encoding)
    except (LookupError, UnicodeError) as exc:
        raise SiteBuildError('建筑 .cpg 中的字符编码无效') from exc
    sample = elevation_sampler(raster)
    accepted = []
    counts = {'invalidHeight': 0, 'invalidFootprint': 0, 'missingDEM': 0, 'repaired': 0}
    try:
        with closing(shapefile.Reader(shp=str(shp), dbf=str(dbf), encoding=encoding)) as reader:
            fields = {field[0].casefold(): field[0] for field in reader.fields[1:]}
            height_field = fields.get('high') or fields.get('height')
            if not height_field:
                raise SiteBuildError('建筑 DBF 缺少 high 或 height 高度字段')
            for index, row in enumerate(reader.iterShapeRecords()):
                try:
                    height = float(row.record[height_field])
                    if not math.isfinite(height) or height <= 0:
                        raise ValueError
                except (ValueError, TypeError, OverflowError):
                    counts['invalidHeight'] += 1
                    continue
                try:
                    shape = geometry.shape(row.shape.__geo_interface__)
                    if not shape.is_valid:
                        shape = make_valid(shape)
                        counts['repaired'] += 1
                    parts = list(polygon_parts(shape))
                    if not parts:
                        raise ValueError
                except (ValueError, TypeError, AttributeError, GEOSException, shapefile.ShapefileException):
                    counts['invalidFootprint'] += 1
                    continue
                name = str(row.record[fields['name']] or '').strip() if 'name' in fields else ''
                record = []
                try:
                    for number, part in enumerate(parts, 1):
                        rings = [[to_geo.transform(x, y) for x, y, *_ in ring.coords]
                                 for ring in (part.exterior, *part.interiors)]
                        ground = [sample(lon, lat) for ring in rings for lon, lat in ring]
                        base, foundation = max(ground), min(ground)
                        local_rings = [[local(lon, lat, base) for lon, lat in ring] for ring in rings]
                        if any(len({(p[0], p[2]) for p in ring[:-1]}) < 3 for ring in local_rings):
                            counts['invalidFootprint'] += 1
                            break
                        record.append({'id': f'{index + 1}-{number}', 'name': name or f'建筑 {index + 1}',
                                       'height': height, 'ground': base, 'foundation': foundation,
                                       'rings': local_rings, 'foundationDepth': base - foundation})
                    else:
                        accepted.extend(record)
                except (SiteBuildError, ValueError, OverflowError):
                    counts['missingDEM'] += 1
            source_features = len(reader)
    except (UnicodeError, shapefile.ShapefileException) as exc:
        raise SiteBuildError('无法读取建筑文件，请检查 .shp、.dbf 和字符编码') from exc
    if not accepted:
        raise SiteBuildError('没有有效建筑，请检查正数高度、多边形足迹以及 DEM 是否覆盖建筑')
    return accepted, counts, height_field, source_features


def build_terrain(raster, bounds, local):
    scale = min(1, MAX_TERRAIN_EDGE / max(raster.shape))
    rows, cols = (max(2, round(size * scale)) for size in raster.shape)
    heights = raster.read(1, out_shape=(rows, cols), masked=True).astype(float)
    heights = heights * raster.scales[0] + raster.offsets[0]
    mask = np.ma.getmaskarray(heights) | ~np.isfinite(heights.data)
    to_geo = Transformer.from_crs(raster.crs, 4326, always_xy=True)
    west, south, east, north = bounds
    positions, indices, uvs = [], [], []
    vertex_ids = np.full((rows, cols), -1, dtype=np.int32)
    xstep, ystep = raster.width / cols, raster.height / rows
    for row, col in zip(*np.nonzero(~mask)):
        x, y = raster.transform * ((col + .5) * xstep, (row + .5) * ystep)
        lon, lat = to_geo.transform(x, y)
        xyz = local(lon, lat, float(heights[row, col]))
        if not all(map(math.isfinite, xyz)):
            raise SiteBuildError('DEM 含有无法转换的坐标')
        vertex_ids[row, col] = len(positions) // 3
        positions.extend(xyz)
        uvs.extend([(lon - west) / (east - west), (lat - south) / (north - south)])
    for row in range(rows - 1):
        for col in range(cols - 1):
            a, b, c, d = map(int, vertex_ids[row:row + 2, col:col + 2].flat)
            if min(a, b, c, d) >= 0:
                indices.extend((a, c, b, b, c, d))
    if not indices:
        raise SiteBuildError('DEM 没有可用的相邻高程像元，请检查无数据区域')
    xs, ys, zs = positions[::3], positions[1::3], positions[2::3]
    return {'positions': positions, 'indices': indices, 'uvs': uvs, 'rows': rows, 'cols': cols,
            'min': min(ys), 'max': max(ys), 'bounds': [min(xs), max(xs), min(zs), max(zs)],
            'resolution': list(raster.res), 'crs': str(raster.crs), 'nodataVertices': int(mask.sum())}


def read_imagery(source, sidecar, output, raster, meta):
    check_raster_header(source)
    try:
        reference = None
        if sidecar:
            data = json.loads(sidecar.read_text(encoding='utf-8-sig'))
            crs, bbox = CRS.from_user_input(data['crs']), list(map(float, data['bbox']))
            west, south, east, north = bbox
            if not all(map(math.isfinite, bbox)) or not (west < east and south < north):
                raise ValueError('影像 bbox 无效')
            reference = crs.to_string(), bbox
        image = prepare_imagery(source, output, raster, reference=reference, max_dimension=4096)
    except (ValueError, KeyError, TypeError, CRSError, RasterioError, OSError) as exc:
        raise SiteBuildError(f'影像 {source.name} 无法定位到 DEM，请检查 RGB 数据、坐标系和覆盖范围；'
                             '无内嵌定位时可提供同名 JSON（crs 和 bbox）') from exc
    return {'image': output.name, 'width': image['textureWidth'], 'height': image['textureHeight'],
            'bbox': meta['bbox'], 'localBounds': meta['localBounds'], 'center': meta['center']}


def file_digest(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def analysis_reference(buildings, terrain, local_center):
    x, _, z = local_center
    west, east, south, north = terrain['bounds']
    radius = min(east - west, north - south) * 0.2
    candidates = []
    for building in buildings:
        xs, zs = zip(*[(p[0], p[2]) for p in building['rings'][0]])
        bx, bz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
        distance = math.hypot(bx - x, bz - z)
        if distance <= radius:
            candidates.append((-building['height'], distance, building['id'], building, [bx, bz]))
    if candidates:
        _, _, _, building, center = min(candidates)
        return {**building, 'center': center, 'shortName': building['name'],
                'selection': 'auto-nearest-tallest'}, None
    points = terrain['positions']
    vertex = min(set(terrain['indices']),
                 key=lambda i: ((points[3*i] - x)**2 + (points[3*i+2] - z)**2, i))
    return None, points[vertex * 3:vertex * 3 + 3]


def build_site(root, slug, name, out, progress):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', slug) or slug in {'con', 'aux', 'nul', 'prn'} or re.fullmatch(r'(com|lpt)[1-9]', slug):
        raise SiteBuildError('模型目录标识需为 1–64 位小写字母、数字或连字符')
    if any(unicodedata.category(ch) in {'Cc', 'Cs'} for ch in name) or not 1 <= len(name.strip()) <= 24:
        raise SiteBuildError('模型名称需为 1–24 个字符，且不能包含控制字符')
    name = name.strip()
    out.mkdir(parents=True, exist_ok=True)
    final = out / slug
    if final.exists() or linked(final):
        raise SiteBuildError('模型输出目录已存在，请使用其他目录标识')
    progress('检查源文件', 5)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_PAM_ENABLED='NO',
                      GDAL_GEOREF_SOURCES='INTERNAL'), TemporaryDirectory(prefix='.building-', dir=out) as scratch:
        shp, dbf, prj, cpg, dem, image, reference, tileset = layers = discover(root)
        check_raster_header(dem)
        folder = Path(scratch) / slug
        folder.mkdir()
        progress('读取 DEM 和坐标变换', 15)
        try:
            raster = rasterio.open(dem)
        except RasterioError as exc:
            raise SiteBuildError(f'无法读取 DEM GeoTIFF：{dem.name}') from exc
        with raster:
            if raster.driver != 'GTiff' or not raster.crs or raster.transform.is_identity:
                raise SiteBuildError(f'DEM GeoTIFF 缺少有效坐标系或地理范围：{dem.name}')
            if (raster.count != 1 or min(raster.shape) < 2 or raster.colorinterp[0] == ColorInterp.palette
                    or raster.dtypes[0].startswith('complex')
                    or not all(math.isfinite(v) for v in (raster.scales[0], raster.offsets[0]))):
                raise SiteBuildError(f'DEM 需要至少 2×2 个像元和单个有效高程波段：{dem.name}')
            bbox = list(transform_bounds(raster.crs, 'EPSG:4326', *raster.bounds, densify_pts=21))
            west, south, east, north = bbox
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise SiteBuildError('DEM 的 WGS84 地理范围无效或跨越了日期变更线')
            center, origin, matrix, projection, local = local_frame(tileset, bbox)
            terrain = build_terrain(raster, bbox, local)
            progress('采样高程并生成建筑', 40)
            buildings, rejected, field, sources = read_buildings(shp, dbf, prj, cpg, raster, local)
            core, anchor = analysis_reference(buildings, terrain, local(*center, 0))
            limitations = ['采用 DEM 原始垂直基准，未换算高程基准。',
                           '建筑以足迹顶点的最高高程为屋顶基面，基础延伸至最低高程。',
                           '地形网格每边最多 512 个采样点，缺失采样值处保留空洞。',
                           '足迹超出 DEM 或在足迹顶点缺少高程的建筑已排除。']
            if not image:
                limitations.append('该模型未提供影像底图。')
            meta = {'name': name, 'center': center, 'origin': origin, 'ecefTransform': matrix,
                    'coordinateSystem': projection, 'bbox': bbox, 'localBounds': terrain['bounds'],
                    'buildingCount': len(buildings), 'sourceFeatures': sources, 'heightField': field,
                    'minHeight': min(b['height'] for b in buildings), 'maxHeight': max(b['height'] for b in buildings),
                    'meshType': 'json', 'custom': True, 'buildingValidation': rejected,
                    'sources': {p.relative_to(root).as_posix(): file_digest(p) for p in layers if p is not None},
                    'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    'limitations': limitations, 'coreBuilding': core, 'analysisAnchor': anchor,
                    'terrain': {key: value for key, value in terrain.items() if key not in {'positions', 'indices', 'uvs'}}}
            progress('处理影像底图', 70)
            if image:
                image_meta = read_imagery(image, reference, folder / f'{slug}-imagery.jpg', raster, meta)
                dump(folder / f'{slug}-imagery.json', image_meta)
            progress('写入并校验模型', 90)
            dump(folder / f'{slug}-gba.json', {'metadata': meta, 'buildings': buildings})
            dump(folder / f'{slug}-gba-meta.json', meta)
            dump(folder / f'{slug}-terrain.json', terrain)
        validate_output(folder, slug)
        folder.rename(final)
    progress('模型生成完成', 100)
    return meta


def validate_output(folder, slug):
    def get(suffix):
        return json.loads((folder / f'{slug}-{suffix}.json').read_text(encoding='utf-8'))

    meta, data, terrain = get('gba-meta'), get('gba'), get('terrain')
    west, east, south, north = meta['localBounds']
    if (meta['buildingCount'] != len(data['buildings']) or meta != data['metadata']
            or not all(map(math.isfinite, meta['localBounds'])) or not (west < east and south < north)
            or not math.isfinite(meta['maxHeight']) or meta['maxHeight'] <= 0
            or len(terrain['positions']) < 12 or not terrain['indices']):
        raise SiteBuildError('模型自检失败，建筑或地形数据不完整')
    if (folder / f'{slug}-imagery.jpg').exists():
        image = get('imagery')
        if image['bbox'] != meta['bbox'] or not 0 < max(image['width'], image['height']) <= 4096:
            raise SiteBuildError('模型自检失败，影像范围或尺寸无效')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--slug', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()

    def progress(stage, percent, error=None):
        data = {'stage': stage, 'progress': percent, 'error': error}
        print(json.dumps(data, ensure_ascii=False), flush=True)

    try:
        build_site(args.input, args.slug, args.name, args.out, progress)
    except Exception as exc:
        message = str(exc) if isinstance(exc, SiteBuildError) else '生成失败，请检查源文件格式、大小和坐标系'
        progress('生成失败', 0, message)
        traceback.print_exc()
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
