import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createModel} from '../src/model.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// GLTFExporter uses this browser API for binary buffer assembly, even without textures.
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}).catch(error=>this.onerror?.(error));}
};
const city=JSON.parse(await readFile(resolve(root,'public/data/city.json'),'utf8'));
const terrain=JSON.parse(await readFile(resolve(root,'public/data/terrain.json'),'utf8'));
const {group}=createModel(city,terrain);
const binary=await new GLTFExporter().parseAsync(group,{binary:true});
await mkdir(resolve(root,'artifacts'),{recursive:true});
await writeFile(resolve(root,'artifacts/zhengzhou-city-enu.glb'),Buffer.from(binary));
console.log(`Exported ${city.buildings.length} building parts + DEM to artifacts/zhengzhou-city-enu.glb (${binary.byteLength} bytes)`);
