import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const key='uav.project-chat.position.v1';
const base=process.env.APP_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const toggleOf=page=>page.getByRole('button',{name:'项目问答',exact:true});
const panelOf=page=>page.locator('#project-chat-panel');
const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});
const ready=page=>page.waitForFunction(()=>document.documentElement.dataset.ready==='true',null,{timeout:120000});

async function mockChat(page){
  await page.route('**/api/project-chat',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{available:true}});
    assert.equal(route.request().postDataJSON().messages.at(-1).content,'设备-3 有什么用途？');
    const events=[{delta:'这是一条浏览器冒烟测试答复。'},{done:true}];
    return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
  });
}

async function drag(page,toggle,x,y){
  const point=center(await toggle.boundingBox());
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  await page.mouse.move(x,y,{steps:12});
  await page.mouse.up();
}

async function assertLayout(page,toggle,panel){
  const size=page.viewportSize(),button=await toggle.boundingBox(),dialog=await panel.boundingBox();
  for(const item of [button,dialog]){
    assert.ok(item.x>=0&&item.y>=0,JSON.stringify(item));
    assert.ok(item.x+item.width<=size.width+.5&&item.y+item.height<=size.height+.5,JSON.stringify(item));
  }
  assert.ok(dialog.y>=button.y+button.height||dialog.y+dialog.height<=button.y,'对话面板不能遮挡按钮');
  return {button,dialog};
}

try{
  await mkdir('artifacts/project-chat',{recursive:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await mockChat(page);
  await page.goto(base);
  await ready(page);
  const toggle=toggleOf(page),panel=panelOf(page);
  const initial=await toggle.boundingBox();
  assert.ok(initial.x>1000&&initial.y>700);
  assert.equal(await toggle.getAttribute('title'),'拖动移动，双击复位');
  assert.equal(await toggle.locator('svg').getAttribute('aria-hidden'),'true');
  await page.evaluate(()=>{
    window.chatTestMapClicks=0;
    document.querySelector('canvas').addEventListener('pointerdown',()=>window.chatTestMapClicks++);
  });
  await drag(page,toggle,255,145);
  const moved=await toggle.boundingBox();
  assert.ok(Math.abs(initial.x-moved.x)>600);
  assert.equal(await panel.isHidden(),true);
  assert.equal(await page.evaluate(()=>window.chatTestMapClicks),0);
  const point=center(moved);
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  await page.mouse.move(point.x+3,point.y);
  await page.mouse.up();
  await panel.waitFor({state:'visible'});
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert.deepEqual(await toggle.boundingBox(),moved);
  const upper=await assertLayout(page,toggle,panel);
  assert.ok(upper.dialog.y>upper.button.y);
  await panel.locator('textarea').fill('设备-3 有什么用途？');
  await panel.getByRole('button',{name:'发送',exact:true}).click();
  await panel.getByText('这是一条浏览器冒烟测试答复。').waitFor();
  await drag(page,toggle,1440,942);
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  const lower=await assertLayout(page,toggle,panel);
  assert.ok(lower.dialog.y<lower.button.y&&lower.dialog.x<lower.button.x);
  assert.ok(Math.abs(upper.dialog.x-lower.dialog.x)>500);
  await page.screenshot({path:'artifacts/project-chat/desktop-1500x1000.png'});
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  assert.ok(Math.abs(saved.x-lower.button.x)<1&&Math.abs(saved.y-lower.button.y)<1);
  await page.reload();
  await ready(page);
  assert.deepEqual(await toggle.boundingBox(),lower.button);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await panel.waitFor({state:'visible'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.x<390,key);
  await assertLayout(page,toggle,panel);
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.y<390,key);
  await assertLayout(page,toggle,panel);
  await page.setViewportSize({width:1500,height:1000});
  await toggle.dblclick();
  await page.waitForFunction(key=>!localStorage.getItem(key),key);
  const reset=await toggle.boundingBox();
  assert.ok(Math.abs(reset.x-initial.x)<2&&Math.abs(reset.y-initial.y)<2);
  await toggle.focus();
  await page.keyboard.press('Space');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.deepEqual(errors,[]);
  await page.close();

  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await mockChat(mobile);
  await mobile.goto(base);
  await ready(mobile);
  const button=toggleOf(mobile),dialog=panelOf(mobile),start=center(await button.boundingBox());
  const cdp=await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170,y:310}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:65,y:80}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await button.boundingBox()).y<200);
  assert.equal(await dialog.isHidden(),true);
  await button.tap();
  await dialog.waitFor({state:'visible'});
  await assertLayout(mobile,button,dialog);
  await mobile.screenshot({path:'artifacts/project-chat/mobile-390x844.png'});
  console.log('项目问答浏览器冒烟通过，已覆盖鼠标、触摸、键盘、缩放夹取、位置持久化和双击复位。');
}finally{
  await browser.close();
}
