"""Warp optional RGB GeoTIFF into a bounded, north-up browser texture."""
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds


def prepare_imagery(source: Path, output: Path, dem):
    if not source.exists():
        output.unlink(missing_ok=True)  # Never reuse a texture from a removed source.
        return None
    bounds = transform_bounds(dem.crs, 'EPSG:4326', *dem.bounds, densify_pts=21)
    west, south, east, north = bounds
    width = min(4096, dem.width * 16)
    height = max(1, round(width * dem.height / dem.width))
    transform = from_bounds(*bounds, width, height)
    with rasterio.open(source) as image:
        if image.crs is None:
            raise ValueError('Imagery must contain a CRS; an unreferenced TIFF cannot be aligned.')
        if image.count < 3 or any(t != 'uint8' for t in image.dtypes[:3]):
            raise ValueError('Imagery currently requires three uint8 RGB bands.')
        image_bounds = transform_bounds(image.crs, 'EPSG:4326', *image.bounds, densify_pts=21)
        if image_bounds[2] <= west or image_bounds[0] >= east or image_bounds[3] <= south or image_bounds[1] >= north:
            raise ValueError('Imagery and terrain do not overlap.')
        rgba = np.concatenate([image.read([1, 2, 3]), image.dataset_mask()[None, :, :]])
        target = np.zeros((4, height, width), dtype=np.uint8)
        reproject(source=rgba, destination=target, src_transform=image.transform,
                  src_crs=image.crs, dst_transform=transform, dst_crs='EPSG:4326',
                  src_alpha=4, dst_alpha=4, resampling=Resampling.bilinear)
        if not np.any(target[3]):
            raise ValueError('Imagery has no valid pixels overlapping the terrain.')
        # Missing imagery uses the terrain's dark backdrop; it never stretches edge pixels.
        alpha = target[3].astype(np.float32)[None, :, :] / 255
        rgb = np.rint(target[:3] * alpha + np.array([36, 61, 70])[:, None, None] * (1 - alpha)).astype(np.uint8)
        with rasterio.open(output, 'w', driver='PNG', width=width, height=height,
                           count=3, dtype='uint8') as png:
            png.write(rgb)
        return {'texture': output.name, 'sourceCRS': str(image.crs),
                'sourceWidth': image.width, 'sourceHeight': image.height,
                'sourceBounds': list(image.bounds), 'sourceNodata': image.nodata,
                'textureCRS': 'EPSG:4326', 'bounds': list(bounds),
                'textureWidth': width, 'textureHeight': height,
                'resampling': 'bilinear; source mask is alpha',
                'validTexturePixels': int(np.count_nonzero(target[3]))}
