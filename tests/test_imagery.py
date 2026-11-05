import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from imagery import prepare_imagery


class ImageryTest(unittest.TestCase):
    def test_north_up_alignment_and_nodata_backdrop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, terrain, output = root/'image.tif', root/'dem.tif', root/'texture.png'
            rgb = np.zeros((3, 4, 4), dtype=np.uint8)
            rgb[:, :2, :2] = np.array([220, 30, 40])[:, None, None]
            rgb[:, 2:, :2] = np.array([20, 30, 230])[:, None, None]
            rgb[:, :, 2:] = 255
            common = dict(driver='GTiff', width=4, height=4, crs='EPSG:4326', transform=from_bounds(0, 0, 4, 4, 4, 4))
            with rasterio.open(source, 'w', count=3, dtype='uint8', nodata=255, **common) as d:
                d.write(rgb)
            with rasterio.open(terrain, 'w', count=1, dtype='float32', **common) as d:
                d.write(np.ones((1, 4, 4), dtype=np.float32))
            with rasterio.open(terrain) as d:
                metadata = prepare_imagery(source, output, d)
            self.assertEqual(metadata['bounds'], [0, 0, 4, 4])
            with rasterio.open(output) as d:
                colors = d.read()
            np.testing.assert_array_equal(colors[:, 4, 4], [220, 30, 40])
            np.testing.assert_array_equal(colors[:, -5, 4], [20, 30, 230])
            np.testing.assert_array_equal(colors[:, 4, -5], [36, 61, 70])

    def test_missing_source_removes_stale_texture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root/'stale.png'
            output.write_bytes(b'stale')
            self.assertIsNone(prepare_imagery(root/'missing.tif', output, None))
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
