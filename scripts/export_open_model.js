import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {buildCityGeometry} from '../src/model.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// GLTFExporter uses FileReader even for untextured binary exports.
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
};
const input=JSON.parse(await readFile(resolve(root,'public/data/open-lod1.json'),'utf8'));
const {geometry}=buildCityGeometry(input.buildings);
// buildCityGeometry assigns height-based colours for the reconstructed city.
// The open comparison layer is a neutral white massing model, so drop them.
geometry.deleteAttribute('color');
const material=new THREE.MeshStandardMaterial({color:0xdde6ea,roughness:0.95,metalness:0,side:THREE.DoubleSide});
const mesh=new THREE.Mesh(geometry,material);mesh.name='Open_GBA_LoD1';
const group=new THREE.Group();group.name='Open_GBA_LoD1';
group.userData={...input.metadata,units:'meters'};
group.add(mesh);
const binary=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:false});
const bytes=Buffer.from(binary);
const output=resolve(root,'public/data/open-lod1.glb');
await mkdir(resolve(root,'public/data'),{recursive:true});
await writeFile(output,bytes);
const sha256=createHash('sha256').update(bytes).digest('hex');
const metadata={...input.metadata,glb:{file:'open-lod1.glb',bytes:bytes.length,sha256},mesh:{vertices:geometry.attributes.position.count,triangles:geometry.attributes.position.count/3,drawCalls:1}};
await writeFile(resolve(root,'public/data/open-lod1-meta.json'),JSON.stringify(metadata,null,2));
console.log(`Exported ${input.buildings.length} GBA buildings to ${output} (${binary.byteLength} bytes, sha256 ${sha256})`);
