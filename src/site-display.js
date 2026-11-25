import * as THREE from 'three';

// Older imagery uses the model's bbox. Newer, wider images carry their own extent.
export function siteImageBounds(model, image) {
  if (!image) throw new Error('缺少影像范围信息');
  const bounds = image.localBounds ?? model.localBounds;
  if (!image.localBounds && !(image.bbox?.length === 4 &&
      image.bbox.every((value, i) => value === model.bbox?.[i]))) {
    throw new Error('影像范围与模型不匹配');
  }
  if ((image.projection && image.projection !== model.metricProjection) ||
      (image.center && (image.center.length !== 2 ||
        !image.center.every((value, i) => value === model.center?.[i])))) {
    throw new Error('影像与模型使用不同的坐标参考');
  }
  if (bounds?.length !== 4 || !bounds.every(Number.isFinite) ||
      bounds[0] >= bounds[1] || bounds[2] >= bounds[3]) {
    throw new Error('影像局部范围无效');
  }
  return bounds;
}

export function siteGroundGeometry([west, east, north, south], elevation) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    west, elevation, north, east, elevation, north,
    east, elevation, south, west, elevation, south,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

export function roofHighlightGeometry(rings, elevation) {
  const paths = rings.map(ring => ring.map(([x, , z]) => new THREE.Vector2(x, -z)));
  const shape = new THREE.Shape(paths[0]);
  shape.holes = paths.slice(1).map(path => new THREE.Path(path));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, elevation, 0);
  return geometry;
}
