import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDevice,DEFAULT_ENV,DEFAULT_TARGET} from '../src/sensors/presets.js';

const url=new URL(process.env.APP_URL||'http://127.0.0.1:5173');
url.searchParams.set('demo','0');
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 await mkdir('artifacts/task3',{recursive:true});
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/\/src\/task3\/ui\.js(?:\?.*)?$/,async route=>{
  const response=await route.fetch(),source=await response.text();
  const anchor='rebuildThreatGround();applyTab();renderThreatConfig();renderEquipmentSelection();controlsEnabled();updateDiagnostics();';
  assert.ok(source.includes(anchor),'设备仿真冒烟需要 Vite 开发服务');
  // 只在测试页面挂载三个标记，站点查询、采样、体渲染及探针仍走应用代码。
  const fixture=`
 window.__demoFixture=({devices,target,environment})=>{
  plan={id:'demo-fixture',name:'设备界面测试',devices,sites:[],metrics:[]};
  report={plans:[plan],recommendedId:plan.id,environment,target,conditions:[{id:'nominal',name:'测试工况'}],
   sampling:{bounds:{core:[0,120,0]}},settings:{coreRadius:150},blindspots:{[plan.id]:[]},emc:{[plan.id]:{verdict:'pass',conflicts:[]}},
   threatsByPlan:{[plan.id]:{single:{frames:[{time:0,targets:[]},{time:120,targets:[]}]}}}};
  deviceDisplay=createDeviceDisplayMap(devices);$('task3-condition').replaceChildren(new Option('测试工况','nominal'));
  $('task3-threat').value='single';mapActive=true;drawCommon();focus([0,170,0],1050);setThreatSpeed(1);
  return beginThreatPlayback();
 };
 `;
  await route.fulfill({response,body:source.replace(anchor,fixture+anchor)});
 });
 await page.goto(url.href,{timeout:120000});
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'&&window.__demoFixture&&window.task3Diagnostics,null,{timeout:180000});
 const devices=[createDevice('radar-02c','fixture-a',[0,180,0]),createDevice('radar-02c','fixture-near',[0,180,0]),createDevice('radar-02c','fixture-far',[280,180,140])];
 await page.locator('#toggle-task3').evaluate(button=>button.click());
 assert.equal(await page.evaluate(data=>window.__demoFixture(data),{devices,target:DEFAULT_TARGET,environment:DEFAULT_ENV}),true);
 const pin=page.locator('#task3-device-info'),hud=page.locator('#task3-device-demo');
 const waitDevice=(id,status='ready')=>page.waitForFunction(({id,status})=>window.task3Diagnostics?.deviceDemo?.deviceId===id&&window.task3Diagnostics.deviceDemo.status===status,{id,status},{timeout:120000});
 const diagnostics=()=>page.evaluate(()=>window.task3Diagnostics.deviceDemo);
 async function select(id){
  if(await pin.isVisible())await pin.getByRole('button',{name:'关闭设备信息'}).click();
  const marker=await page.evaluate(id=>{
   const canvas=document.querySelector('#viewport canvas'),rect=canvas.getBoundingClientRect();
   const point=window.task3Diagnostics.deviceMarkers.find(item=>item.deviceId===id);
   if(!point)return null;
   const x=rect.left+point.x,y=rect.top+point.y;
   return document.elementFromPoint(x,y)===canvas?{x,y}:null;
  },id);
  assert.ok(marker,`测试标记应可点击 ${id}`);
  await page.mouse.move(marker.x,marker.y);
  try{
   await page.waitForFunction(id=>document.querySelector('#task3-device-hover').dataset.deviceId===id,id,{timeout:12000});
   await page.mouse.click(marker.x,marker.y);
   await page.waitForFunction(id=>window.task3Diagnostics.pinnedDeviceId===id,id,{timeout:12000});
  }
  catch(error){
   const state=await page.evaluate(({x,y})=>({hit:document.elementFromPoint(x,y)?.id,panelHidden:document.querySelector('#task3-panel').hidden,hoverId:document.querySelector('#task3-device-hover').dataset.deviceId,actualMarkers:window.task3Diagnostics.deviceMarkers,layerVisible:window.task3Diagnostics.layerVisible}),marker);
   throw Error(`无法命中设备 ${id}: ${JSON.stringify({marker,state})}`,{cause:error});
  }
 }
 const start=()=>pin.getByRole('button',{name:'设备仿真'}).click();
 const viewBefore=await page.evaluate(()=>window.task3Diagnostics.cameraPosition);
 await select('fixture-a');await start();await waitDevice('fixture-a');
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false);
 assert.equal((await diagnostics()).activeCount,1);
 assert.equal((await diagnostics()).volume,true);
 assert.ok((await diagnostics()).samples>0&&(await diagnostics()).samples<=24000);
 assert.deepEqual((await diagnostics()).position,devices[0].position);
 assert.match(await hud.locator('.demo-hud-metric').textContent(),/探测裕量/);
 assert.equal(await hud.locator('.demo-scale span').count(),3);
 await start();assert.equal((await diagnostics()).starts,1);
 await page.mouse.move(550,455);
 await page.waitForFunction(()=>window.task3Diagnostics.deviceDemo.probe,null,{timeout:12000});
 assert.match(await hud.locator('dl').textContent(),/坐标|离地高度/);
 await page.screenshot({path:'artifacts/task3/device-demo-desktop.png'});
 await select('fixture-near');await start();
 await page.getByText('设备间距小于 30 m，已有临近设备仿真，请先停止',{exact:true}).waitFor({state:'visible'});
 assert.equal((await diagnostics()).deviceId,'fixture-a');assert.equal((await diagnostics()).starts,1);
 await select('fixture-far');await start();await waitDevice('fixture-far');
 assert.equal((await diagnostics()).activeCount,1);assert.equal((await diagnostics()).disposals,1);
 await page.setViewportSize({width:390,height:844});
 const stop=hud.getByRole('button',{name:'停止仿真'});
 const box=await hud.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
 assert.ok(await stop.isVisible());await page.screenshot({path:'artifacts/task3/device-demo-390x844.png'});
 await stop.click();await waitDevice(null,'stopped');
 assert.equal(await hud.isHidden(),true);assert.equal((await diagnostics()).volume,false);assert.equal((await diagnostics()).listening,false);
 await page.waitForFunction(before=>window.task3Diagnostics.cameraPosition.every((value,index)=>Math.abs(value-before[index])<.1),viewBefore,{timeout:10000});
 assert.equal(await page.evaluate(()=>window.task3Diagnostics.threatPlaying),false);
 assert.deepEqual(errors,[]);
 console.log('设备仿真浏览器冒烟通过：共用体场探针、重复启动、临近拒绝、远距替换、小屏停止及相机恢复。');
}finally{await browser.close();}
