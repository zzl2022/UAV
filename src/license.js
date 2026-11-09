// Local access gate for the demo build. The key is a separate file that is not
// committed with the project. Without it, secondary menus and the two run
// buttons stay inert; there is deliberately no visible error or hint.
const EXPECTED_KEY_HASH=0x8927d36d;
const MILK_EGG_CLICKS=25;
const GATED_SELECTOR=[
 '#open-city-model',
 '#toggle-sensors',
 '#toggle-deployment',
 '.ac8-hud-tabs button',
 '.ac8-scene-tabs button',
 '.equipment-group-nav button',
 '.task3-tabs button',
 '.task3-subnav-btn',
 '.deployment-tabs button',
 '#task3-run',
 '#task3-run-side',
 '#ac8-sim-start',
].join(',');

let unlocked=false;
let lockedClicks=0;
let milkEggShown=false;

function fnv1a(text){
 let hash=0x811c9dc5;
 for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,0x01000193)>>>0;}
 return hash>>>0;
}

async function checkKey(){
 try{
  const url=new URL(`${import.meta.env.BASE_URL}uav.key`,document.baseURI);
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)return;
  const text=(await response.text()).replace(/^﻿/,'').trim();
  unlocked=text.length>0&&fnv1a(text)===EXPECTED_KEY_HASH;
 }catch{unlocked=false;}
}

function showMilkEgg(){
 if(milkEggShown)return;
 milkEggShown=true;
 const image=new URL(`${import.meta.env.BASE_URL}奶蛋2.jpg`,document.baseURI).href;
 document.documentElement.style.setProperty('--milk-egg-bg',`url("${image}")`);
 document.body.classList.add('milk-egg-bg');
}

export function initLicenseGate(){
 document.addEventListener('click',event=>{
  if(unlocked)return;
  const element=event.target instanceof Element?event.target:null;
  if(!element?.closest(GATED_SELECTOR))return;
  event.preventDefault();
  event.stopImmediatePropagation();
  lockedClicks+=1;
  if(lockedClicks>=MILK_EGG_CLICKS)showMilkEgg();
 },true);
 checkKey();
}
