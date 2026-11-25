import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename} from 'node:path';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {buildCityGeometry} from '../src/model.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
};
const [inputArg,outputArg,groupArg]=process.argv.slice(2);
if(!inputArg||!outputArg){
  console.error('Usage: node scripts/export_gba_site_model.js <input.json> <output.glb> [groupName]');
  process.exit(1);
}
const input=resolve(root,inputArg),output=resolve(root,outputArg);
const groupName=groupArg||'GBA_Site_LoD1';
const payload=JSON.parse(await readFile(input,'utf8'));
const {geometry}=buildCityGeometry(payload.buildings);
geometry.deleteAttribute('color');
const material=new THREE.MeshStandardMaterial({color:0xdde6ea,roughness:0.95,metalness:0,side:THREE.DoubleSide});
const mesh=new THREE.Mesh(geometry,material);mesh.name=groupName;
const group=new THREE.Group();group.name=groupName;group.userData={...payload.metadata,units:'meters'};group.add(mesh);
const binary=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:false});
const bytes=Buffer.from(binary);
await mkdir(dirname(output),{recursive:true});
await writeFile(output,bytes);
const sha256=createHash('sha256').update(bytes).digest('hex');
const meta={...payload.metadata,glb:{file:basename(output),bytes:bytes.length,sha256},mesh:{vertices:geometry.attributes.position.count,triangles:geometry.attributes.position.count/3,drawCalls:1}};
await writeFile(output.replace(/\.glb$/,'-meta.json'),JSON.stringify(meta,null,2));
console.log(`Exported ${payload.buildings.length} GBA buildings to ${output} (${bytes.length} bytes)`);
