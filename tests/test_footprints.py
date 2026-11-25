import hashlib
import json
from pathlib import Path
import sys
import unittest

import numpy as np
from pyproj import Transformer
import rasterio
from shapely import STRtree
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data'
sys.path.insert(0, str(ROOT / 'scripts'))
from wuxi_footprints import polygon_from_building


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


class FootprintTest(unittest.TestCase):
    def test_wuxi_uses_separate_footprints_and_matching_glb(self):
        folder = DATA / 'sites/wuxi'
        model = read(folder / 'wuxi-gba.json')
        glb_meta = read(folder / 'wuxi-gba-meta.json')
        self.assertEqual(glb_meta['buildingCount'], len(model['buildings']))
        self.assertEqual(glb_meta['glb']['sha256'],
                         hashlib.sha256((folder / 'wuxi-gba.glb').read_bytes()).hexdigest())
        core = model['metadata']['coreBuilding']
        self.assertEqual(core['rings'], next(b['rings'] for b in model['buildings'] if b['id'] == core['id']))
        self.assertNotIn('gba-ours2-11755499-0', {b['id'] for b in model['buildings']})
        footprints = [polygon_from_building(building) for building in model['buildings']]
        self.assertTrue(all(p.is_valid for p in footprints))
        for i, j in zip(*STRtree(footprints).query(footprints, predicate='intersects')):
            if i < j:
                # Allow centimetre rounding at formerly crossing boundaries.
                self.assertLess(footprints[i].intersection(footprints[j]).area, 0.1)

    def test_wenbo_corridor_matches_image_and_enu_model(self):
        city = read(DATA / 'city.json')
        metadata = city['metadata']
        correction, = metadata['footprintCorrections']
        self.assertEqual(correction['sourceIndex'], 13492)
        building_id = f"{correction['sourceId']}-{correction['sourceIndex']}-0"
        corridor = next(b for b in city['buildings'] if b['id'] == building_id)
        feature = next(f for f in read(DATA / 'buildings.geojson')['features']
                       if f['properties']['source_index'] == correction['sourceIndex'])
        ring, = feature['geometry']['coordinates'][0]
        self.assertEqual(corridor['height'], 7)
        self.assertTrue(Polygon(ring).is_valid)
        photo = ROOT / '创意二文件/创意二数据集/区域数据/影像/raster.tif'
        with rasterio.open(photo) as image:
            x, y = zip(*[(~image.transform) @ tuple(point) for point in ring])
        self.assertAlmostEqual(min(x), 2865.0, delta=0.1)
        self.assertAlmostEqual(min(y), 1125.0, delta=0.1)
        self.assertAlmostEqual(max(x), 2888.1, delta=0.1)

        matrix = np.array(metadata['ecefTransform']).reshape(4, 4, order='F')
        lon, lat = zip(*ring)
        ecef = Transformer.from_crs(4979, 4978, always_xy=True)
        xyz = np.array(ecef.transform(lon, lat, np.full(len(ring), corridor['ground']))).T
        east, north, up = ((xyz - matrix[:3, 3]) @ matrix[:3, :3]).T
        np.testing.assert_allclose(corridor['rings'][0], np.column_stack((east, up, -north)), atol=0.001)
