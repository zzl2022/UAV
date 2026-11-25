import * as THREE from 'three';

export function buildCityGeometry(buildings) {
  const positions = [], colors = [], indices = [], ranges = [];
  for (const building of buildings) {
    const rings = building.rings.map(r => r.slice(0, -1).map(p => new THREE.Vector2(p[0], p[2])));
    const flat = rings.flat();
    const base = building.rings[0][0][1];
    const bottom = base - building.foundationDepth;
    const top = base + building.height;
    const offset = positions.length / 3;
    const color = new THREE.Color().setHSL(0.52 + Math.min(building.height / 136, 1) * 0.12, 0.35, 0.62);
    for (const y of [bottom, top]) for (const p of flat) {
      positions.push(p.x, y, p.y); colors.push(color.r, color.g, color.b);
    }
    const firstTriangle = indices.length / 3;
    for (const [a,b,c] of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      indices.push(offset+a+flat.length,offset+c+flat.length,offset+b+flat.length);
      indices.push(offset+a,offset+b,offset+c);
    }
    let start = 0;
    for (const ring of rings) {
      for (let i=0;i<ring.length;i++) {
        const a=offset+start+i,b=offset+start+(i+1)%ring.length;
        indices.push(a,b,b+flat.length,a,b+flat.length,a+flat.length);
      }
      start += ring.length;
    }
    ranges.push({start:firstTriangle,end:indices.length/3,building});
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  // Flat normals keep roof edges crisp; rendering is batched into a single draw call.
  const flat = geometry.toNonIndexed(); geometry.dispose();
  flat.computeVertexNormals(); flat.computeBoundingBox();
  return {geometry:flat,ranges};
}
export function buildTerrainGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  if (data.uvs?.length) geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));
  geometry.setIndex(data.indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}
export function createModel(city, terrain) {
  const group = new THREE.Group(); group.name='Zhengzhou_City_ENU';
  group.userData={...city.metadata,units:'meters'};
  const {geometry,ranges}=buildCityGeometry(city.buildings);
  const buildings=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.82,side:THREE.DoubleSide}));
  buildings.name='Buildings_SHP_high_DEM';
  const ground=new THREE.Mesh(buildTerrainGeometry(terrain),new THREE.MeshStandardMaterial({color:0x243d46,roughness:1,side:THREE.DoubleSide}));
  ground.name='Terrain_DEM';
  group.add(ground,buildings);
  return {group,buildings,ground,ranges};
}
