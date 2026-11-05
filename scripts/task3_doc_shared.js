import {readFile} from 'node:fs/promises';

export const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
export const escapeHtml=value=>String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const num=(value,digits=2)=>Number(value).toFixed(digits);
export const pct=(value,digits=2)=>value===null||value===undefined?'不适用':`${(value*100).toFixed(digits)}%`;
export const pp=value=>`${value>=0?'+':''}${Number(value).toFixed(2)} 个百分点`;
export const jsonText=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export const inlineData=(id,value)=>`<script type="application/json" id="${escapeHtml(id)}">${jsonText(value)}</script>`;

export function assertEvidence(value,path='evidence'){
 if(value===undefined)throw Error(`${path} 不得为 undefined`);
 if(typeof value==='number'&&!Number.isFinite(value))throw Error(`${path} 含非有限数值`);
 if(Array.isArray(value)){value.forEach((item,index)=>assertEvidence(item,`${path}[${index}]`));return;}
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))assertEvidence(item,`${path}.${key}`);
}

export async function embedImage(path){
 return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

export function table(headers,rows,{className='',maxHeight='640px'}={}){
 return `<div class="table-wrap" style="max-height:${maxHeight}"><table class="${className}"><thead><tr>${headers.map(header=>`<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function groupedBarChart({title='',rows,series,width=880,rowHeight=58,valueSuffix='',valueDigits=2}){
 if(!rows.length)throw Error('图表没有数据');
 const height=70+rows.length*rowHeight,max=Math.max(...rows.flatMap(row=>row.values),1e-9),left=185,right=70,top=title?42:18,plotWidth=width-left-right;
 const ticks=[0,.25,.5,.75,1].map(ratio=>{const x=left+plotWidth*ratio,value=max*ratio;return `<line x1="${x}" y1="${top-5}" x2="${x}" y2="${height-30}" stroke="var(--line)" stroke-dasharray="3 5"/><text x="${x}" y="${height-10}" text-anchor="middle" class="axis">${num(value,valueDigits)}${escapeHtml(valueSuffix)}</text>`;}).join('');
 const body=rows.map((row,index)=>{
  const y=top+index*rowHeight,groupHeight=rowHeight-18,barHeight=Math.min(15,groupHeight/series.length-2);
  const bars=row.values.map((value,j)=>{const h=Math.max(0,value)/max*plotWidth,by=y+j*(barHeight+3);return `<rect x="${left}" y="${by}" width="${Math.max(0,h)}" height="${barHeight}" rx="3" fill="${series[j].color}"/><text x="${Math.min(width-5,left+h+7)}" y="${by+barHeight-3}" class="value">${num(value,valueDigits)}${escapeHtml(valueSuffix)}</text>`;}).join('');
  return `<text x="${left-12}" y="${y+groupHeight/2+4}" text-anchor="end" class="label">${escapeHtml(row.label)}</text>${bars}`;
 }).join('');
 const legend=series.map((item,index)=>`<span class="legend"><i style="background:${item.color}"></i>${escapeHtml(item.name)}</span>`).join('');
 return `<figure><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${title?`<text x="${left}" y="18" class="chart-title">${escapeHtml(title)}</text>`:''}${ticks}${body}</svg><figcaption class="legend-row">${legend}</figcaption></figure>`;
}

export function lineChart({title='',points,width=880,height=250,xLabel='步骤',yLabel='数值',color='var(--accent)',valueDigits=2}){
 if(points.length<2)throw Error('折线图至少需要两个点');
 const left=58,right=25,top=42,bottom=48,xs=points.map(point=>point.x),ys=points.map(point=>point.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(0,...ys),y1=Math.max(...ys,1e-9),X=x=>left+(x-x0)/Math.max(1e-9,x1-x0)*(width-left-right),Y=y=>top+(y1-y)/Math.max(1e-9,y1-y0)*(height-top-bottom);
 const path=points.map((point,index)=>`${index?'L':'M'}${X(point.x).toFixed(1)},${Y(point.y).toFixed(1)}`).join(' ');
 const dots=points.map((point,index)=>`<circle cx="${X(point.x)}" cy="${Y(point.y)}" r="3.5" fill="${color}"><title>${escapeHtml(point.label??`步骤 ${point.x}`)}: ${num(point.y,valueDigits)}</title></circle>${index%Math.max(1,Math.ceil(points.length/12))===0?`<text x="${X(point.x)}" y="${height-25}" text-anchor="middle" class="axis">${escapeHtml(point.x)}</text>`:''}`).join('');
 return `<figure><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><text x="${left}" y="18" class="chart-title">${escapeHtml(title)}</text><line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" stroke="var(--line)"/><line x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}" stroke="var(--line)"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}<text x="${width-90}" y="${height-8}" class="axis">${escapeHtml(xLabel)}</text><text x="8" y="${top-18}" class="axis">${escapeHtml(yLabel)}</text></svg></figure>`;
}

export function flowSvg(steps,{title='运行流程'}={}){
 if(!steps.length)throw Error('流程图没有步骤');
 const width=880,height=steps.length*72+34;
 const body=steps.map((step,index)=>{
  const y=36+index*72,detail=typeof step==='string'?step:step.detail,titleText=typeof step==='string'?`步骤 ${index+1}`:step.title;
  return `${index?`<path d="M440 ${y-16} v12" stroke="var(--accent)" marker-end="url(#arrow)"/>`:''}<rect x="80" y="${y}" width="720" height="52" rx="8" fill="var(--panel)" stroke="var(--line)"/><text x="100" y="${y+21}" class="label">${escapeHtml(titleText)}</text><text x="100" y="${y+41}" class="muted">${escapeHtml(detail)}</text>`;
 }).join('');
 return `<figure><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L8,4L0,8z" fill="var(--accent)"/></marker></defs><text x="80" y="18" class="chart-title">${escapeHtml(title)}</text>${body}</svg></figure>`;
}

export const baseCss=`
:root{--bg:#0e1922;--panel:#152635;--ink:#e6f1f7;--muted:#93b3c4;--line:#2a4553;--accent:#5fd4b8;--gold:#ffd783;--warn:#ff9f5a;--bad:#ff776d;--blue:#70d6ff;--purple:#b89aff}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.78 "Microsoft YaHei","PingFang SC",sans-serif;overflow-x:hidden}.wrap{max-width:1180px;margin:auto;padding:0 26px 70px}header.hero{padding:48px 0 28px;border-bottom:1px solid var(--line)}.kicker{color:var(--accent);letter-spacing:.14em;font-size:12px}h1{font-size:31px;line-height:1.4;margin:10px 0}h2{margin:46px 0 12px;padding-left:12px;border-left:4px solid var(--accent);font-size:23px}h3{font-size:18px;color:var(--gold);margin:26px 0 9px}p{margin:8px 0}.muted,.evidence,figcaption{color:var(--muted);font-size:12.5px}.badge{display:inline-block;padding:2px 10px;border:1px solid var(--accent);border-radius:99px;color:var(--accent);font-size:12px;margin:3px 5px 3px 0}.toc{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px 20px;margin:22px 0}.toc a{color:var(--accent);text-decoration:none}.toc ol{margin:6px 0;padding-left:22px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px;margin:18px 0}.card,.box,.rule,.case{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:12px 0}.card .num{font-size:25px;color:var(--accent);font-weight:700;line-height:1.3}.card .label{color:var(--muted);font-size:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;margin:12px 0}table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--panel)}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);position:sticky;top:0;background:#182b39;z-index:1;white-space:nowrap}td{white-space:nowrap}.notice{border-left:4px solid var(--gold);background:#262b29;padding:12px 16px;margin:14px 0}.notice.bad{border-color:var(--bad)}.formula{background:#0a141c;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:13px 17px;margin:12px 0;font:13px/1.9 Consolas,monospace;overflow:auto}.rule{border-left:4px solid var(--accent)}.evidence{border-top:1px dashed var(--line);padding-top:8px;overflow-wrap:anywhere}.chart{display:block;width:100%;height:auto;max-width:100%;margin:12px auto;background:#0c1720;border:1px solid var(--line);border-radius:8px}.chart-title{fill:var(--ink);font-size:14px;font-weight:600}.axis{fill:var(--muted);font-size:10px}.label{fill:var(--ink);font-size:12px}.value{fill:var(--ink);font-size:10px}.muted{fill:var(--muted);font-size:11px}figure{margin:18px 0;text-align:center}.legend-row{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}figure img{display:block;max-width:100%;margin:auto;border:1px solid var(--line);border-radius:8px}code{color:var(--gold);overflow-wrap:anywhere}pre{background:#0a141c;border:1px solid var(--line);border-radius:8px;padding:13px 16px;overflow:auto;font-size:12px}footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:720px){.wrap{padding:0 14px 45px}h1{font-size:25px}.grid2{grid-template-columns:1fr}.card{padding:13px}.toc{padding:12px 15px}}@media print{body{background:white;color:#111}.wrap{max-width:none}.card,.box,.rule,.case,.toc{break-inside:avoid}.table-wrap{max-height:none!important;overflow:visible}header.hero{padding-top:10px}}
`;

export function documentShell({title,kicker,subtitle,meta='',toc=[],body,data,dataId='task3-doc-data'}){
 assertEvidence(data);
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${baseCss}</style></head><body><main class="wrap"><header class="hero"><div class="kicker">${escapeHtml(kicker)}</div><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p><div class="muted">${meta}</div></header><nav class="toc"><strong>目录</strong><ol>${toc.map(item=>`<li><a href="#${escapeHtml(item.id)}">${escapeHtml(item.label)}</a></li>`).join('')}</ol></nav>${body}<footer>本文档由真实 report/run 与浏览器实测证据生成。图表、截图、样式和结构化数据均内嵌，可离线复核；模型结论不替代现场测量、施工设计或频谱合规认证。</footer></main>${inlineData(dataId,data)}</body></html>`;
}
