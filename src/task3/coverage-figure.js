// Group the final per-device detection mask by horizontal distance and altitude.
// Both projections use the same counts. Averaging around a ring removes azimuth.
export function coverageBands(device,samples,masks){
 const heights=[...new Set(samples.map(p=>p.agl))].sort((a,b)=>a-b);
 const distances=samples.map(p=>Math.hypot(p.position[0]-device.position[0],p.position[2]-device.position[2]));
 const step=Math.max(1,Math.ceil(distances.reduce((max,d)=>Math.max(max,d),0)/4));
 const indices=samples.map((p,i)=>heights.indexOf(p.agl)*4+Math.min(3,Math.floor(distances[i]/step)));
 const totals=Array(heights.length*4).fill(0);
 for(const j of indices)totals[j]++;
 const hits=masks.map(mask=>{
  if(mask.length!==samples.length)throw Error('设备覆盖矩阵与采样数量不符');
  const row=totals.map(()=>0);
  indices.forEach((j,i)=>{if(mask[i])row[j]++;});return row;
 });
 return {heights,step,totals,hits};
}

export function pairedCoverageSvg(bands,conditionIndex){
 const {heights,step,totals}=bands,hits=bands.hits[conditionIndex];
 if(!hits||!heights.length)return null;
 const colors=['#eef3f4','#bfd9dc','#79b2b7','#478893','#205867'];
 const color=i=>totals[i]?colors[Math.min(4,Math.floor(5*hits[i]/totals[i]))]:'#dadada';
 const parts=['<svg xmlns="http://www.w3.org/2000/svg" width="560" height="148" viewBox="0 0 560 148"><rect width="560" height="148" fill="#ffffff"/>'];
 const label=(x,y,s)=>parts.push(`<text x="${x}" y="${y}" font-size="11" fill="#243943" text-anchor="middle">${s}</text>`);
 const rect=(x,y,w,h,fill)=>parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#ffffff" stroke-width="1"/>`);
 const rowH=Math.min(28,100/heights.length);
 for(let h=0;h<heights.length;h++){
  const y=112-(h+1)*rowH;
  label(27,y+rowH/2+4,heights[h]+'m');
  for(let b=0;b<4;b++){
   const i=h*4+b;
   rect(50+48*b,y,48,rowH,color(i));
   parts.push(`<text x="${74+48*b}" y="${y+rowH/2+4}" text-anchor="middle" font-size="10" fill="${totals[i]&&hits[i]/totals[i]>=.6?'#ffffff':'#253a42'}">${totals[i]?Math.round(100*hits[i]/totals[i])+'%':'–'}</text>`);
  }
 }
 for(let b=0;b<=4;b++)label(50+b*48,130,b*step);
 // Axonometric projections of horizontal, concentric sample bands at the recorded AGLs.
 const top=heights.at(-1),bottom=heights[0];
 for(let h=0;h<heights.length;h++){
  const y=bottom===top?75:119-93*(heights[h]-bottom)/(top-bottom);
  for(let b=3;b>=0;b--)parts.push(`<ellipse cx="411" cy="${y}" rx="${(b+1)*22}" ry="${(b+1)*3.7}" fill="${color(4*h+b)}" stroke="#70878b" stroke-width="0.7"/>`);
  label(528,y+3,heights[h]+'m');
 }
 parts.push('</svg>');return parts.join('');
}
