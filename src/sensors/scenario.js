import {MODEL_VERSION} from './engine.js';
import {DEFAULT_ENV,DEFAULT_TARGET,createDevice} from './presets.js';
export function defaultScenario(city){
 const b=city.buildings[Math.floor(city.buildings.length/2)];
 const xs=b.rings[0].map(p=>p[0]),zs=b.rings[0].map(p=>p[2]);
 const x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2;
 const position=[x,b.rings[0][0][1]+b.height+2,z];
 return {modelVersion:MODEL_VERSION,origin:[...city.metadata.origin],devices:['radar-02c','optical-nvt','radio-tdoa','acoustic-cry'].map((id,i)=>createDevice(id,`sensor-${i+1}`,position)),target:{...structuredClone(DEFAULT_TARGET),position:[x,position[1]+30,z-300]},environment:{...DEFAULT_ENV}};
}
