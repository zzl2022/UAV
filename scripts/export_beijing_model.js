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
const dir=resolve(root,'public/data/beijing');
const input=JSON.parse(await readFile(resolve(dir,'beijing-cnbh.json'),'utf8'));
const {geometry}=buildCityGeometry(input.buildings);
geometry.deleteAttribute('color');
const material=new THREE.MeshStandardMaterial({color:0xdde6ea,roughness:0.95,metalness:0,transparent:true,opacity:0.72,side:THREE.DoubleSide});
const mesh=new THREE.Mesh(geometry,material);mesh.name='Beijing_CNBH_5km';
const group=new THREE.Group();group.name='Beijing_CNBH_5km';group.userData={...input.metadata,units:'meters'};group.add(mesh);
const binary=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:false});
const bytes=Buffer.from(binary);
await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,'beijing-cnbh.glb'),bytes);
const sha256=createHash('sha256').update(bytes).digest('hex');
const meta={...input.metadata,glb:{file:'beijing-cnbh.glb',bytes:bytes.length,sha256},mesh:{vertices:geometry.attributes.position.count,triangles:geometry.attributes.position.count/3,drawCalls:1}};
await writeFile(resolve(dir,'beijing-cnbh-meta.json'),JSON.stringify(meta,null,2));
console.log(`Exported ${input.buildings.length} CNBH blocks to ${resolve(dir,'beijing-cnbh.glb')} (${bytes.length} bytes)`);
