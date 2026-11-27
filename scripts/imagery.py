"""Warp optional RGB GeoTIFF into a bounded, north-up browser texture."""
from pathlib import Path
import numpy as np
import rasterio
from rasterio import Affine
from rasterio.enums import Resampling
from rasterio.transform import array_bounds, from_bounds
from rasterio.warp import reproject, transform_bounds
from PIL import Image


def prepare_imagery(source: Path, output: Path, dem, *, reference=None, max_dimension=None):
    if not source.exists():
        output.unlink(missing_ok=True)  # Never reuse a texture from a removed source.
        return None
    bounds = transform_bounds(dem.crs, 'EPSG:4326', *dem.bounds, densify_pts=21)
    west, south, east, north = bounds
    width = min(4096, dem.width * 16)
    height = max(1, round(width * dem.height / dem.width))
    if max_dimension:
        scale = min(16, max_dimension / max(dem.width, dem.height))
        width, height = (max(1, round(size * scale)) for size in (dem.width, dem.height))
    transform = from_bounds(*bounds, width, height)
    with rasterio.open(source) as image:
        crs, image_transform, source_bounds = image.crs, image.transform, image.bounds
        if (crs is None or image_transform.is_identity) and reference:
            crs, source_bounds = reference
            image_transform = from_bounds(*source_bounds, image.width, image.height)
            source_bounds = array_bounds(image.height, image.width, image_transform)
        if crs is None or (max_dimension and image_transform.is_identity):
            raise ValueError('Imagery must contain a CRS; an unreferenced TIFF cannot be aligned.')
        if image.count < 3 or any(t != 'uint8' for t in image.dtypes[:3]):
            raise ValueError('Imagery currently requires three uint8 RGB bands.')
        image_bounds = transform_bounds(crs, 'EPSG:4326', *source_bounds, densify_pts=21)
        if image_bounds[2] <= west or image_bounds[0] >= east or image_bounds[3] <= south or image_bounds[1] >= north:
            raise ValueError('Imagery and terrain do not overlap.')
        source_scale = min(1, max_dimension / max(image.width, image.height)) if max_dimension else 1
        source_shape = tuple(max(1, round(size * source_scale)) for size in (image.height, image.width))
        rgba = np.concatenate([image.read([1, 2, 3], out_shape=source_shape),
                               image.dataset_mask(out_shape=source_shape)[None, :, :]])
        if source_shape != image.shape:
            image_transform @= Affine.scale(image.width / source_shape[1], image.height / source_shape[0])
        target = np.zeros((4, height, width), dtype=np.uint8)
        reproject(source=rgba, destination=target, src_transform=image_transform,
                  src_crs=crs, dst_transform=transform, dst_crs='EPSG:4326',
                  src_alpha=4, dst_alpha=4, resampling=Resampling.bilinear)
        if not np.any(target[3]):
            raise ValueError('Imagery has no valid pixels overlapping the terrain.')
        # Missing imagery uses the terrain's dark backdrop; it never stretches edge pixels.
        alpha = target[3].astype(np.float32)[None, :, :] / 255
        rgb = np.rint(target[:3] * alpha + np.array([36, 61, 70])[:, None, None] * (1 - alpha)).astype(np.uint8)
        if output.suffix.lower() == '.jpg':
            Image.fromarray(np.moveaxis(rgb, 0, -1)).save(output, quality=85)
        else:
            with rasterio.open(output, 'w', driver='PNG', width=width, height=height,
                               count=3, dtype='uint8') as png:
                png.write(rgb)
        return {'texture': output.name, 'sourceCRS': str(crs),
                'sourceWidth': image.width, 'sourceHeight': image.height,
                'sourceBounds': list(source_bounds), 'sourceNodata': image.nodata,
                'textureCRS': 'EPSG:4326', 'bounds': list(bounds),
                'textureWidth': width, 'textureHeight': height,
                'resampling': 'bilinear; source mask is alpha',
                'validTexturePixels': int(np.count_nonzero(target[3]))}
