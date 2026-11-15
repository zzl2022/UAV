import * as THREE from 'three';

/**
 * Red holographic quadcopter used as the UAV icon. The group's local +Z axis is
 * the flight direction, so the planning layer only has to orient the group
 * toward the route tangent each frame. `userData.rotors` holds the spinning
 * rotor groups so both the single-flight and threat playback renderers can
 * animate them consistently.
 */
export function createDroneMesh(){
 const drone=new THREE.Group();drone.name='UAV_Quadcopter';
 const core=new THREE.MeshBasicMaterial({color:0xff3524,transparent:true,opacity:.98,depthTest:false,toneMapped:false});
 const trim=new THREE.MeshBasicMaterial({color:0xffd06a,transparent:true,opacity:.95,depthTest:false,toneMapped:false});
 const glow=new THREE.MeshBasicMaterial({color:0xff3a1e,transparent:true,opacity:.2,depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false});
 const rotors=[];

 const add=(mesh,glowScale=1)=>{
  mesh.renderOrder=60;drone.add(mesh);
  if(glowScale>0){const g=mesh.clone();g.material=glow;g.scale.multiplyScalar(glowScale);g.renderOrder=59;drone.add(g);}
  return mesh;
 };

 // fuselage + tapered nose
 const body=add(new THREE.Mesh(new THREE.BoxGeometry(17,7,28),core));
 body.position.set(0,0,2);
 const nose=add(new THREE.Mesh(new THREE.ConeGeometry(6.5,14,6),core),1.35);
 nose.rotation.x=Math.PI/2;nose.position.set(0,0,20);
 const spine=add(new THREE.Mesh(new THREE.BoxGeometry(5,3,20),trim),0);
 spine.position.set(0,5,2);

 // four arms and motor pods
 for(const [x,z] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
  const arm=add(new THREE.Mesh(new THREE.BoxGeometry(4,2.6,30),core),1.15);
  arm.position.set(x*8.5,0,z*8.5);
  arm.rotation.y=Math.atan2(x,z);
  const pod=add(new THREE.Mesh(new THREE.CylinderGeometry(4.6,4.2,5,10),trim),0);
  pod.position.set(x*17,1.5,z*17);
  const rotor=new THREE.Group();rotor.position.set(x*17,4.4,z*17);
  const disc=new THREE.Mesh(new THREE.TorusGeometry(9.5,1.1,5,18),core);disc.rotation.x=Math.PI/2;disc.renderOrder=62;rotor.add(disc);
  const blur=new THREE.Mesh(new THREE.CircleGeometry(9.5,18),new THREE.MeshBasicMaterial({color:0xff6a3a,transparent:true,opacity:.12,depthTest:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}));blur.rotation.x=-Math.PI/2;blur.renderOrder=59;rotor.add(blur);
  drone.add(rotor);rotors.push(rotor);
 }

 // gimbal camera under the nose
 const gimbal=add(new THREE.Mesh(new THREE.SphereGeometry(4.4,10,8),core),1.3);
 gimbal.position.set(0,-4.6,12);
 const lens=add(new THREE.Mesh(new THREE.SphereGeometry(2.2,8,6),trim),0);
 lens.position.set(0,-4.8,15.4);

 // navigation lights: green left, red right, white strobe at the tail
 const nav=(color,x,y,z)=>{const light=new THREE.Mesh(new THREE.SphereGeometry(1.8,8,6),new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));light.position.set(x,y,z);light.renderOrder=63;drone.add(light);};
 nav(0x62ff9b,-18.5,0.4,0);nav(0xff5648,18.5,0.4,0);nav(0xf2fbff,0,1,-15);

 // antenna
 const antenna=add(new THREE.Mesh(new THREE.CylinderGeometry(0.8,0.8,12,6),trim),0);
 antenna.position.set(0,7,-9);

 drone.userData.rotors=rotors;
 return drone;
}
