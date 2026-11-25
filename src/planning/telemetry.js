// Local scene [east, up, -north] -> source ENU -> WGS84.
export function flightTelemetry(position,transform,groundAt){
 const [east,up,south]=position,north=-south;
 const xyz=[0,1,2].map(i=>transform[12+i]+transform[i]*east+transform[4+i]*north+transform[8+i]*up);
 const [x,y,z]=xyz,a=6378137,e2=6.6943799901413165e-3,p=Math.hypot(x,y);
 let lat=Math.atan2(z,p*(1-e2));
 for(let i=0;i<8;i++){const n=a/Math.sqrt(1-e2*Math.sin(lat)**2);lat=Math.atan2(z+e2*n*Math.sin(lat),p);}
 const n=a/Math.sqrt(1-e2*Math.sin(lat)**2),elevation=p/Math.cos(lat)-n,ground=groundAt(east,south);
 return {position:[...position],longitude:Math.atan2(y,x)*180/Math.PI,latitude:lat*180/Math.PI,elevation,agl:ground===null?null:up-ground};
}
