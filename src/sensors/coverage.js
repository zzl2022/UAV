import * as THREE from 'three';
import {opticalFov} from './engine.js';
// Closed spherical annular sector: true slant range, blind zone and instantaneous FOV.
export function nominalCoverage(device,target){
 const p=device.parameters,fov=device.type==='optical'?opticalFov(p,target.opticalMode):null;
 const horizontal=fov?.horizontal??p.azimuthFov;
 const low=Math.min(90,Math.max(-90,p.pitch+(fov?-fov.vertical/2:p.elevationMin)));
 const high=Math.max(-90,Math.min(90,p.pitch+(fov?fov.vertical/2:p.elevationMax)));
 const min=Math.min(low,high),max=Math.max(low,high),positions=[],indices=[];
 const point=(r,a,e)=>{a*=Math.PI/180;e*=Math.PI/180;return [r*Math.cos(e)*Math.sin(a),r*Math.sin(e),-r*Math.cos(e)*Math.cos(a)];};
 function surface(rows,cols,fn){const offset=positions.length/3;for(let i=0;i<=rows;i++)for(let j=0;j<=cols;j++)positions.push(...fn(i/rows,j/cols));for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){const a=offset+i*(cols+1)+j,b=a+1,c=a+cols+1,d=c+1;indices.push(a,b,c,b,d,c);}}
 const az=t=>p.heading-horizontal/2+horizontal*t,el=t=>min+(max-min)*t,r=t=>p.minRange+(p.maxRange-p.minRange)*t;
 surface(12,64,(u,v)=>point(p.maxRange,az(v),el(u)));
 if(p.minRange>0)surface(12,64,(u,v)=>point(p.minRange,az(v),el(u)));
 for(const elevation of [min,max])surface(1,64,(u,v)=>point(r(u),az(v),elevation));
 if(horizontal<360)for(const a of [az(0),az(1)])surface(12,1,(u,v)=>point(r(v),a,el(u)));
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
 geometry.userData={kind:'nominal-range-shade',maxRange:p.maxRange,minRange:p.minRange,horizontalFov:horizontal,elevationMin:min,elevationMax:max,heading:p.heading};
 return geometry;
}
