"""Build a local ENU city from repository SHP + DEM; preserve all source files."""
from pathlib import Path
import json
import shutil
import hashlib
import math
import shapefile
import rasterio
import numpy as np
from pyproj import CRS, Transformer
from shapely import geometry, make_valid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '创意二文件/创意二数据集/区域数据'
OUT = ROOT / 'public/data'

def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    shp = SOURCE / 'building/zheng_apart.shp'
    dem = SOURCE / 'dem/dem.tif'
    tiles = SOURCE / '白模/zhengzhou1/tileset.json'
    tile_data = json.loads(tiles.read_text())
    matrix = np.array(tile_data['root']['transform']).reshape((4, 4), order='F')
    rotation, translation = matrix[:3, :3], matrix[:3, 3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-7):
        raise ValueError('Tileset transform must be orthonormal ENU.')
    to_ecef = Transformer.from_crs(4979, 4978, always_xy=True)
    from_ecef = Transformer.from_crs(4978, 4979, always_xy=True)
    origin = from_ecef.transform(*translation)
    def local(lon, lat, height):
        ecef = np.array(to_ecef.transform(lon, lat, height))
        enu = rotation.T @ (ecef - translation)
        return [round(float(enu[0]), 3), round(float(enu[2]), 3), round(float(-enu[1]), 3)]
    shp_crs = CRS.from_wkt(shp.with_suffix('.prj').read_text())
    to_geo = Transformer.from_crs(shp_crs, 4326, always_xy=True)
    reader = shapefile.Reader(str(shp), encoding=shp.with_suffix('.cpg').read_text().strip())
    buildings, features = [], []
    repaired, excluded, missing_dem = 0, [], 0
    interpolated_dem = 0
    max_sample_distance = 0.0
    with rasterio.open(dem) as raster:
        if raster.crs is None: raise ValueError('DEM has no CRS')
        to_dem = Transformer.from_crs(4326, raster.crs, always_xy=True)
        raster_geo = Transformer.from_crs(raster.crs, 4326, always_xy=True)
        heights = raster.read(1, masked=True)
        mask = np.ma.getmaskarray(heights)
        valid_rows, valid_cols = np.where(~mask)
        def sample(lon, lat):
            nonlocal missing_dem, interpolated_dem, max_sample_distance
            x, y = to_dem.transform(lon, lat)
            row, col = raster.index(x, y)
            if not (0 <= row < raster.height and 0 <= col < raster.width):
                missing_dem += 1
                raise ValueError(f'Building lies outside DEM: {lon}, {lat}')
            if mask[row, col]:
                # Edge-only gaps: nearest valid cell, limited to 100 m; never infer an unbounded terrain.
                dx = abs(raster.res[0]) * 111320 * math.cos(lat * math.pi / 180)
                dy = abs(raster.res[1]) * 111320
                distances = ((valid_rows-row)*dy)**2 + ((valid_cols-col)*dx)**2
                nearest = int(np.argmin(distances))
                distance = float(math.sqrt(distances[nearest]))
                if distance > 100: raise ValueError(f'DEM gap exceeds 100 m at {lon}, {lat}')
                interpolated_dem += 1
                max_sample_distance = max(max_sample_distance, distance)
                return float(heights[valid_rows[nearest], valid_cols[nearest]])
            return float(heights[row, col])
        for index, record in enumerate(reader.iterShapeRecords()):
            props = record.record.as_dict()
            height = float(props['high'])
            if not math.isfinite(height) or height <= 0: raise ValueError(f'Invalid high at {index}')
            shape = geometry.shape(record.shape.__geo_interface__)
            if not shape.is_valid:
                repaired += 1
                shape = make_valid(shape)
            polygons = [shape] if shape.geom_type == 'Polygon' else [g for g in shape.geoms if g.geom_type == 'Polygon']
            if not polygons:
                excluded.append(index)
                continue
            geo_polygons = []
            for part, poly in enumerate(polygons):
                rings = []
                for ring in [poly.exterior, *poly.interiors]:
                    rings.append([list(to_geo.transform(x, y)) for x, y, *_ in ring.coords])
                ground = [sample(*p) for ring in rings for p in ring]
                base, foundation = max(ground), min(ground)
                local_rings = [[local(lon, lat, base) for lon, lat in ring] for ring in rings]
                buildings.append({'id': str(props.get('ID') or index) + f'-{index}-{part}', 'name': props.get('NAME') or f'建筑 {index+1}', 'height': height, 'ground': base, 'foundation': foundation, 'rings': local_rings, 'foundationDepth': base-foundation})
                geo_polygons.append(rings)
            features.append({'type':'Feature','properties':{'source_index':index,'name':props.get('NAME') or '', 'height':height,'height_source':'DBF.high','base_elevation':min(b['ground'] for b in buildings[-len(polygons):]),'vertical_datum':'DEM source; unspecified'},'geometry':{'type':'MultiPolygon','coordinates':geo_polygons}})
        positions, indices = [], []
        vertex_ids = {}
        for row in range(raster.height):
            for col in range(raster.width):
                if mask[row, col]: continue
                vertex_ids[row*raster.width+col] = len(positions)//3
                x, y = raster.xy(row, col)
                lon, lat = raster_geo.transform(x, y)
                positions.extend(local(lon, lat, float(heights[row, col])))
        for row in range(raster.height-1):
            for col in range(raster.width-1):
                a = row*raster.width+col; b=a+1; c=a+raster.width; d=c+1
                if all(i in vertex_ids for i in [a,b,c,d]):
                    indices.extend(vertex_ids[i] for i in [a,c,b,b,c,d])
        terrain = {'positions':positions,'indices':indices,'rows':raster.height,'cols':raster.width,'min':float(heights.min()),'max':float(heights.max()),'crs':str(raster.crs),'resolution':list(raster.res),'bounds':list(raster.bounds)}
    metadata = {'name':'郑州 · 河南博物院片区','origin':list(origin),'coordinateSystem':'Local ENU mapped to Three.js [east, up, -north], meters','ecefTransform':tile_data['root']['transform'],'buildingCRS':shp_crs.to_string(),'sourceFeatures':len(reader),'buildingParts':len(buildings),'repairedFeatures':repaired,'excludedFeatures':excluded,'missingDEMSamples':missing_dem,'nearestDEMSamples':interpolated_dem,'maxNearestDEMDistanceMeters':max_sample_distance,'terrainNodataCells':int(mask.sum()),'heightField':'high','minHeight':min(b['height'] for b in buildings),'maxHeight':max(b['height'] for b in buildings),'terrain':{k:v for k,v in terrain.items() if k not in ['positions','indices']},'sources':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [shp,shp.with_suffix('.dbf'),shp.with_suffix('.prj'),dem,tiles]},'limitations':['DEM vertical datum is not specified in source; elevations are used as supplied, without geoid correction.','Footprint roof base uses maximum DEM sample at vertices; walls extend to minimum sample for foundations.','DEM nodata cells are omitted from the terrain. Building vertices on small gaps use nearest valid samples within 100 m, counted in this report.','No imagery is present in the current repository. No road centerlines are supplied.','Original white-model vertical semantics are not documented; it is a separate comparison layer.']}
    dump(OUT/'city.json', {'metadata':metadata,'buildings':buildings})
    dump(OUT/'terrain.json', terrain)
    dump(OUT/'buildings.geojson', {'type':'FeatureCollection','features':features})
    dump(OUT/'report.json',metadata)
    for p in tiles.parent.glob('*.glb'): shutil.copyfile(p,OUT/p.name)
    dump(OUT/'tileset.json',tile_data)
    print(json.dumps({k:v for k,v in metadata.items() if k not in ['sources','ecefTransform','limitations']},ensure_ascii=False,indent=2))
    return metadata

if __name__ == '__main__': build()
