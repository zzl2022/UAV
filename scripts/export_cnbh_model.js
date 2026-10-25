import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {buildCityGeometry} from '../src/model.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
};
const dataDir=resolve(root,'public/data/sat3dgen');
const input=JSON.parse(await readFile(resolve(dataDir,'cnbh-model.json'),'utf8'));
const {geometry}=buildCityGeometry(input.buildings);
geometry.deleteAttribute('color');
const material=new THREE.MeshStandardMaterial({color:0xdde6ea,roughness:0.95,metalness:0,side:THREE.DoubleSide});
const mesh=new THREE.Mesh(geometry,material);mesh.name='CNBH_10m_Full_Extent';
const group=new THREE.Group();group.name='CNBH_10m_Full_Extent';group.userData={...input.metadata,units:'meters'};group.add(mesh);
const binary=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:false});
const bytes=Buffer.from(binary);
await mkdir(dataDir,{recursive:true});
await writeFile(resolve(dataDir,'cnbh-model.glb'),bytes);
const sha256=createHash('sha256').update(bytes).digest('hex');
const meta={...input.metadata,glb:{file:'cnbh-model.glb',bytes:bytes.length,sha256},
  mesh:{vertices:geometry.attributes.position.count,triangles:geometry.attributes.position.count/3,drawCalls:1}};
await writeFile(resolve(dataDir,'cnbh-model-meta.json'),JSON.stringify(meta,null,2));
const manifestPath=resolve(dataDir,'manifest.json');
let manifest={};
try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{}
manifest.cnbhMesh='cnbh-model.glb';
manifest.cnbhJson='cnbh-model.json';
manifest.cnbhSource=meta.source;
manifest.cnbhSourceUrl=meta.sourceUrl;
manifest.cnbhLicense=meta.license;
manifest.cnbhAttribution=meta.attribution;
manifest.cnbhBuildingCount=meta.buildingCount;
manifest.cnbhHeightRange=[meta.minHeight,meta.maxHeight];
manifest.cnbhResolutionMeters=meta.cnbhResolutionMeters;
manifest.cnbhFallbackCount=meta.skipped?.fallback??0;
manifest.status=manifest.status||'ready';
await writeFile(manifestPath,JSON.stringify(manifest,null,2));
console.log(`Exported ${input.buildings.length} CNBH buildings to ${resolve(dataDir,'cnbh-model.glb')} (${bytes.length} bytes)`);
