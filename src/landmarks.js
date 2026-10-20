import * as THREE from 'three';
export function museumLandmark(city){
 const buildings=city.buildings.filter(b=>b.name==='河南博物院');
 if(!buildings.length)return null;
 const main=buildings.reduce((a,b)=>b.height>a.height?b:a);
 const points=main.rings[0],xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
 return {name:'河南博物院',buildingIds:buildings.map(b=>b.id),position:[(Math.min(...xs)+Math.max(...xs))/2,points[0][1]+main.height,(Math.min(...zs)+Math.max(...zs))/2],source:'建筑 DBF.NAME 精确匹配；主楼取最高建筑'};
}
export function mountLandmarks({city,scene,camera,controls,viewport}){
 const landmark=museumLandmark(city);if(!landmark)return {update(){}};
 const group=new THREE.Group();group.name='Henan_Museum_Landmark';
 for(const b of city.buildings.filter(b=>landmark.buildingIds.includes(b.id))){
  const points=b.rings[0].map(p=>new THREE.Vector3(p[0],p[1]+b.height+0.4,p[2]));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xffd783,depthTest:false,transparent:true,opacity:0.85})));
 }
 scene.add(group);
 const label=document.createElement('button');label.id='museum-label';label.className='map-landmark';label.textContent='⌖ 河南博物院';label.title=landmark.source;viewport.append(label);
 const focus=document.createElement('button');focus.id='museum-focus';focus.textContent='⌖ 定位河南博物院';viewport.parentElement.append(focus);
 function locate(){const p=new THREE.Vector3(...landmark.position);controls.target.copy(p);camera.position.copy(p).add(new THREE.Vector3(450,500,650));controls.update();}
 label.onclick=locate;focus.onclick=locate;
 const vector=new THREE.Vector3();
 function update(){camera.updateMatrixWorld();vector.fromArray(landmark.position);vector.y+=25;vector.project(camera);const visible=vector.z>=-1&&vector.z<=1&&Math.abs(vector.x)<0.95&&Math.abs(vector.y)<0.92;label.hidden=!visible;if(visible){label.style.left=`${(vector.x+1)/2*viewport.clientWidth}px`;label.style.top=`${(1-vector.y)/2*viewport.clientHeight}px`;}}
 return {update,landmark};
}
