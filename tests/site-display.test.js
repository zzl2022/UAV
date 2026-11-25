import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {siteImageBounds, siteGroundGeometry, roofHighlightGeometry} from '../src/site-display.js';

for (const id of ['shenzhen', 'wuxi', 'hangzhou']) {
  test(`${id} map corners are north-up and the ground meets the shipped building mesh`, () => {
    const base = new URL(`../public/data/sites/${id}/${id}-`, import.meta.url);
    const read = suffix => readFileSync(new URL(base.href + suffix));
    const model = JSON.parse(read('gba-meta.json'));
    const image = JSON.parse(read('imagery.json'));
    const glb = read('gba.glb');
    const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
    const primitive = gltf.meshes[0].primitives[0];
    const baseY = gltf.accessors[primitive.attributes.POSITION].min[1];
    const bounds = siteImageBounds(model, image);
    assert.deepEqual(bounds, id === 'shenzhen' ? model.localBounds : image.localBounds);
    const plane = siteGroundGeometry(bounds, model.baseElevation);
    const [west, east, north, south] = bounds.map(Math.fround);
    assert.deepEqual([...plane.attributes.position.array], [
      west, baseY, north, east, baseY, north, east, baseY, south, west, baseY, south,
    ]);
    assert.deepEqual([...plane.attributes.uv.array], [0, 1, 1, 1, 1, 0, 0, 0]);
    for (let i = 0; i < 4; i++) assert.equal(plane.attributes.normal.getY(i), 1);
    plane.dispose();
  });
}

test('an image with missing or incompatible registration cannot be stretched over the model', () => {
  const model = {bbox:[1, 2, 3, 4], localBounds:[-5, 5, -4, 4], center:[2, 3], metricProjection:'local_tmerc'};
  for (const image of [null, {}, {bbox:[0, 2, 3, 4]}, {localBounds:[5, -5, 4, -4]},
    {localBounds:model.localBounds, center:[2, 4]}, {localBounds:model.localBounds, projection:'utm'}]) {
    assert.throws(() => siteImageBounds(model, image));
  }
});

test('a roof overlay preserves a courtyard and accepts both open and closed rings', () => {
  const outer = [[0,0,0], [6,0,0], [6,0,6], [0,0,6]];
  const hole = [[1,0,1], [1,0,4], [4,0,4], [4,0,1]];
  for (const ring of [outer, [...outer, outer[0]]]) {
    const roof = roofHighlightGeometry([ring, hole], 20);
    const p = roof.attributes.position;
    let area = 0;
    for (let i = 0; i < roof.index.count; i += 3) {
      const [a, b, c] = roof.index.array.subarray(i, i + 3);
      area += Math.abs((p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a)) -
        (p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))) / 2;
    }
    assert.equal(area, 27);
    for (let i = 0; i < p.count; i++) assert.equal(p.getY(i), 20);
    roof.dispose();
  }
});
