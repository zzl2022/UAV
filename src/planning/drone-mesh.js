import * as THREE from 'three';

export function createDroneMesh(){
 const drone=new THREE.Group();drone.name='Quadcopter_Drone';
 const body=new THREE.Mesh(new THREE.SphereGeometry(12,12,8),new THREE.MeshBasicMaterial({color:0xff776d,depthTest:false}));body.name='Drone_Body';drone.add(body);
 for(const x of [-1,1])for(const z of [-1,1]){
  const rotor=new THREE.Mesh(new THREE.TorusGeometry(9,1.8,5,15),new THREE.MeshBasicMaterial({color:0xffd783,depthTest:false}));
  rotor.name='Drone_Rotor';rotor.rotation.x=Math.PI/2;rotor.position.set(x*18,0,z*18);drone.add(rotor);
 }
 return drone;
}
