"""Fetch GlobalBuildingAtlas LoD1 buildings for the repository extent.

The output is a local ENU building set that replaces the proprietary NoLod
white model in the browser comparison layer.  Source: GlobalBuildingAtlas
LoD1 (CC BY-NC 4.0), which combines 3D-GloBFP and OpenStreetMap buildings.

Two input modes are supported:
  * default: query the public GBA WFS (requires network);
  * --input: reuse a previously downloaded GeoJSON FeatureCollection.

Run with the project venv, e.g.:
  .venv/Scripts/python.exe scripts/prepare_open_model.py
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import struct
import time
from urllib.parse import urlencode

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '创意二文件/创意二数据集/区域数据'
SHP = SOURCE / 'building/zheng_apart.shp'
DEM = SOURCE / 'dem/dem.tif'
TILESET = SOURCE / '白模/zhengzhou1/tileset.json'
OUT = ROOT / 'public/data'
CACHE = ROOT / 'artifacts/open-lod1-raw.geojson'

GBA_BASE = 'https://tubvsig-so2sat-vm1.srv.mwn.de'
GBA_LAYER = 'global3D:lod1_global'
LICENSE = 'CC BY-NC 4.0'
SOURCE_NAME = 'GlobalBuildingAtlas LoD1'
ATTRIBUTION = ('GlobalBuildingAtlas (TUM), 3D-GloBFP, '
               '© OpenStreetMap contributors')
SOURCE_URL = 'https://huggingface.co/datasets/zhu-xlab/GBA.LoD1'
CITATION = ('Zhu et al. (2025), GlobalBuildingAtlas, Earth System Science Data, '
            'https://doi.org/10.5194/essd-17-6647-2025')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
    'Referer': GBA_BASE + '/',
}

# WGS84 ellipsoid.
A = 6378137.0
E2 = 6.6943799901413165e-3


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def shp_bbox_wgs84(path=SHP):
    """Read the SHP header bbox (EPSG:3857) and return WGS84 lon/lat bounds."""
    header = path.read_bytes()[:100]
    xmin, ymin, xmax, ymax = struct.unpack('<4d', header[36:68])
    radius = 6378137.0

    def mercator_to_wgs84(x, y):
        lon = x / radius * 180 / math.pi
        lat = (2 * math.atan(math.exp(y / radius)) - math.pi / 2) * 180 / math.pi
        return lon, lat

    west, south = mercator_to_wgs84(xmin, ymin)
    east, north = mercator_to_wgs84(xmax, ymax)
    return west, south, east, north


def geodetic_to_ecef(lon, lat, height):
    lon, lat = math.radians(lon), math.radians(lat)
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    return (
        (n + height) * math.cos(lat) * math.cos(lon),
        (n + height) * math.cos(lat) * math.sin(lon),
        (n * (1 - E2) + height) * math.sin(lat),
    )


def ecef_to_geodetic(x, y, z):
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - E2))
    for _ in range(8):
        n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
        lat = math.atan2(z + E2 * n * math.sin(lat), p)
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    lon = math.atan2(y, x)
    height = p / math.cos(lat) - n
    return math.degrees(lon), math.degrees(lat), height


def load_transform():
    tile_data = json.loads(TILESET.read_text(encoding='utf-8'))
    matrix = np.array(tile_data['root']['transform']).reshape((4, 4), order='F')
    rotation, translation = matrix[:3, :3], matrix[:3, 3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-7):
        raise ValueError('Tileset transform must be an orthonormal ENU frame')
    origin = ecef_to_geodetic(*translation)

    def local(lon, lat, height):
        ecef = np.array(geodetic_to_ecef(lon, lat, height))
        enu = rotation.T @ (ecef - translation)
        return [round(float(enu[0]), 3), round(float(enu[2]), 3),
                round(float(-enu[1]), 3)]

    return local, origin, tile_data


class Dem:
    """DEM sampler with the same nearest-valid policy as prepare_data.py."""

    def __init__(self, path=DEM):
        self.nearest_samples = 0
        self.max_nearest_distance = 0.0
        try:
            import rasterio
            self._raster = rasterio.open(path)
            self._array = self._raster.read(1, masked=True)
            self._mask = np.ma.getmaskarray(self._array)
            self._data = np.ma.getdata(self._array)
            self._rows, self._cols = np.where(~self._mask)
            self._width, self._height = self._raster.width, self._raster.height
            self._res = self._raster.res
            self._index = self._raster.index
            self.crs = str(self._raster.crs)
            self.backend = f'rasterio {__import__("rasterio").__version__}'
        except ImportError:
            import tifffile
            self._raster = None
            self._data = tifffile.imread(path)
            nodata = -9999
            self._mask = self._data == nodata
            self._rows, self._cols = np.where(~self._mask)
            self._height, self._width = self._data.shape
            world = path.with_suffix('.tfw').read_text(encoding='utf-8').split()
            self._px, self._py = float(world[0]), float(world[3])
            self._x0, self._y0 = float(world[4]), float(world[5])
            self._res = (self._px, abs(self._py))
            self.crs = 'EPSG:4326 (world file; no rasterio)'
            self.backend = f'tifffile {__import__("tifffile").__version__}'

    def sample(self, lon, lat):
        if self._raster is not None:
            row, col = self._index(lon, lat)
        else:
            col = math.floor((lon - self._x0) / self._px)
            row = math.floor((self._y0 - lat) / abs(self._py))
        if not (0 <= row < self._height and 0 <= col < self._width):
            return None
        if not self._mask[row, col]:
            return float(self._data[row, col])
        dx = abs(self._res[0]) * 111320 * math.cos(math.radians(lat))
        dy = abs(self._res[1]) * 111320
        distances = ((self._rows - row) * dy) ** 2 + ((self._cols - col) * dx) ** 2
        nearest = int(np.argmin(distances))
        distance = float(math.sqrt(distances[nearest]))
        if distance > 100:
            return None
        self.nearest_samples += 1
        self.max_nearest_distance = max(self.max_nearest_distance, distance)
        return float(self._data[self._rows[nearest], self._cols[nearest]])


def _open_session():
    session = requests.Session()
    session.headers.update(HEADERS)
    # The viewer sets a cookie used by the WFS session gate.
    session.get(GBA_BASE + '/', timeout=60).raise_for_status()
    return session


def _viewer_session(session):
    response = session.get(GBA_BASE + '/viewer-session', timeout=60)
    response.raise_for_status()
    return response.json()['viewerSession']


def _wfs_url(bbox, session):
    params = {
        'service': 'WFS',
        'version': '2.0.0',
        'request': 'GetFeature',
        'typeNames': GBA_LAYER,
        'outputFormat': 'application/json',
        'srsName': 'EPSG:4326',
        'bbox': ','.join(f'{v:.6f}' for v in bbox) + ',EPSG:4326',
        'viewerSession': session,
    }
    return GBA_BASE + '/geoserver/ows?' + urlencode(params)


def fetch_cell(bbox, retries=5):
    last_error = None
    for attempt in range(retries):
        try:
            session = _open_session()
            token = _viewer_session(session)
            response = session.get(_wfs_url(bbox, token), timeout=240)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'GBA WFS failed for {bbox}: {last_error}')


def fetch_gba(bbox, cache_dir, nx=6, ny=3, refresh=False):
    """Split the extent so each WFS response stays small and retryable."""
    west, south, east, north = bbox
    cache_dir.mkdir(parents=True, exist_ok=True)
    features, seen = [], set()
    for i in range(nx):
        for j in range(ny):
            cell = (
                west + (east - west) * i / nx,
                south + (north - south) * j / ny,
                west + (east - west) * (i + 1) / nx,
                south + (north - south) * (j + 1) / ny,
            )
            cell_file = cache_dir / f'cell-{i}-{j}.json'
            payload = None
            if cell_file.exists() and not refresh:
                try:
                    payload = json.loads(cell_file.read_text(encoding='utf-8'))
                except json.JSONDecodeError:
                    payload = None
            if payload is None:
                payload = fetch_cell(cell)
                cell_file.write_text(json.dumps(payload, ensure_ascii=False,
                                                separators=(',', ':')),
                                     encoding='utf-8')
            for feature in payload.get('features', []):
                props = feature.get('properties') or {}
                key = (props.get('source'), props.get('id'), props.get('ogc_fid'))
                if key in seen:
                    continue
                seen.add(key)
                features.append(feature)
            print(f'  cell {i + 1}/{nx},{j + 1}/{ny}: '
                  f'{len(payload.get("features", []))} features')
    return {'type': 'FeatureCollection', 'features': features,
            'bbox': list(bbox)}


def _closed(ring):
    return ring if ring[0] == ring[-1] else ring + [ring[0]]


def convert(features, dem, local, min_height):
    buildings, skipped = [], {'lowHeight': 0, 'noDem': 0, 'invalid': 0}
    for feature in features:
        props = feature.get('properties') or {}
        height = props.get('height')
        if not isinstance(height, (int, float)) or not math.isfinite(height):
            skipped['invalid'] += 1
            continue
        if height < min_height:
            skipped['lowHeight'] += 1
            continue
        geometry = feature.get('geometry') or {}
        if geometry.get('type') == 'Polygon':
            polygons = [geometry.get('coordinates') or []]
        elif geometry.get('type') == 'MultiPolygon':
            polygons = geometry.get('coordinates') or []
        else:
            skipped['invalid'] += 1
            continue
        parts = 0
        for polygon in polygons:
            rings = []
            for ring in polygon:
                if len(ring) < 4:
                    continue
                rings.append(_closed([[float(p[0]), float(p[1])] for p in ring]))
            if not rings:
                continue
            grounds = [dem.sample(lon, lat) for ring in rings for lon, lat in ring]
            if any(value is None for value in grounds):
                skipped['noDem'] += 1
                continue
            base, foundation = max(grounds), min(grounds)
            local_rings = [[local(lon, lat, base) for lon, lat in ring] for ring in rings]
            if any(len(ring) < 4 for ring in local_rings):
                continue
            source_id = str(props.get('id') or props.get('ogc_fid') or len(buildings))
            part_id = f'gba-{source_id}-{parts}'
            buildings.append({
                'id': part_id,
                'sourceId': source_id,
                'source': props.get('source') or 'unknown',
                'name': f'GBA {source_id}',
                'height': round(float(height), 2),
                'ground': round(base, 2),
                'foundation': round(foundation, 2),
                'foundationDepth': round(base - foundation, 2),
                'rings': local_rings,
            })
            parts += 1
    return buildings, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path,
                        help='local GeoJSON FeatureCollection instead of WFS')
    parser.add_argument('--cache', type=Path, default=CACHE,
                        help='write/read the downloaded raw FeatureCollection')
    parser.add_argument('--cache-dir', type=Path,
                        default=ROOT / 'artifacts/open-lod1-cells',
                        help='per-tile WFS cache directory')
    parser.add_argument('--min-height', type=float, default=2.0,
                        help='skip GBA blobs lower than this (default: 2 m)')
    parser.add_argument('--margin', type=float, default=0.001,
                        help='bbox margin in degrees (default: 0.001)')
    parser.add_argument('--refresh', action='store_true',
                        help='ignore cached cells and raw FeatureCollection')
    args = parser.parse_args()

    west, south, east, north = shp_bbox_wgs84()
    bbox = (west - args.margin, south - args.margin,
            east + args.margin, north + args.margin)
    print(f'Repository bbox: {bbox}')

    payload = None
    if args.input:
        raw_bytes = args.input.read_bytes()
        payload = json.loads(raw_bytes)
    elif args.cache.exists() and not args.refresh:
        raw_bytes = args.cache.read_bytes()
        try:
            payload = json.loads(raw_bytes)
            print(f'Using cached {args.cache}')
        except json.JSONDecodeError:
            print(f'Cached {args.cache} is invalid; refetching')
    if payload is None:
        print('Downloading GBA LoD1 via WFS...')
        payload = fetch_gba(bbox, args.cache_dir, refresh=args.refresh)
        raw_bytes = json.dumps(payload, ensure_ascii=False,
                               separators=(',', ':')).encode('utf-8')
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_bytes(raw_bytes)
        print(f'Cached {len(raw_bytes):,} bytes to {args.cache}')

    local, origin, tile_data = load_transform()
    dem = Dem()
    buildings, skipped = convert(payload.get('features', []), dem, local,
                                 args.min_height)
    if not buildings:
        raise SystemExit('No GBA buildings with usable DEM support were converted')
    heights = [b['height'] for b in buildings]
    metadata = {
        'name': SOURCE_NAME,
        'source': SOURCE_NAME,
        'sourceUrl': SOURCE_URL,
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'citation': CITATION,
        'coordinateSystem': 'Local ENU mapped to Three.js [east, up, -north], meters',
        'origin': list(origin),
        'ecefTransform': tile_data['root']['transform'],
        'bbox': list(bbox),
        'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'rawSha256': sha256_bytes(raw_bytes),
        'featureCount': len(payload.get('features', [])),
        'buildingCount': len(buildings),
        'skipped': skipped,
        'minHeightFilter': args.min_height,
        'minHeight': min(heights),
        'maxHeight': max(heights),
        'heightSource': 'GBA LoD1 (3D-GloBFP/OSM fusion)',
        'demBackend': dem.backend,
        'demCrs': dem.crs,
        'demNearestSamples': dem.nearest_samples,
        'demMaxNearestDistanceMeters': round(dem.max_nearest_distance, 3),
        'groundSampling': 'maximum DEM value at footprint vertices; foundation to minimum',
        'limitations': [
            'Heights are model estimates from the GlobalBuildingAtlas, not surveyed values.',
            'Footprints and heights are open data; they are not the repository SHP and may differ from it.',
            'The model is a LoD1 massing layer for visual comparison only; it has no facades or textures.',
            'License is CC BY-NC 4.0: non-commercial use with attribution.',
            'DEM vertical datum is unspecified, so absolute elevations are not survey-grade.',
        ],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    output = {'metadata': metadata, 'buildings': buildings}
    text = json.dumps(output, ensure_ascii=False, separators=(',', ':'))
    (OUT / 'open-lod1.json').write_text(text, encoding='utf-8')
    print(f'Wrote {len(buildings)} buildings to {OUT / "open-lod1.json"} '
          f'({len(text):,} bytes)')
    print(f'Height range: {metadata["minHeight"]}-{metadata["maxHeight"]} m; '
          f'skipped {skipped}')


if __name__ == '__main__':
    main()
