import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {flightTelemetry} from '../src/planning/telemetry.js';
import {createVoiceAlarm} from '../src/planning/voice.js';
test('telemetry respects source ENU axes and separates AGL from WGS84 model elevation',()=>{
 const {metadata}=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
 const origin=flightTelemetry([0,0,0],metadata.ecefTransform,()=>-10);
 assert.ok(Math.abs(origin.longitude-metadata.origin[0])<1e-8);assert.ok(Math.abs(origin.latitude-metadata.origin[1])<1e-8);assert.ok(Math.abs(origin.elevation-metadata.origin[2])<1e-5);assert.equal(origin.agl,10);
 const east=flightTelemetry([100,100,0],metadata.ecefTransform,()=>40),north=flightTelemetry([0,0,-100],metadata.ecefTransform,()=>null);
 assert.ok(east.longitude>origin.longitude);assert.ok(north.latitude>origin.latitude);assert.equal(east.agl,60);assert.equal(north.agl,null);
});
test('voice is opt-in, chooses Chinese, limits repeated alarms and cancels stale speech',()=>{
 const spoken=[];let cancels=0;const host={SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{cancel(){cancels++;},getVoices:()=>[{lang:'zh-CN',localService:true}],speak:v=>spoken.push(v)}};
 const voice=createVoiceAlarm(host);assert.equal(voice.announce('alarm','报警'),false);voice.setEnabled(true);
 assert.equal(voice.announce('alarm','首次报警',{now:0}),true);assert.equal(spoken[0].lang,'zh-CN');assert.equal(spoken[0].voice.localService,true);
 assert.equal(voice.announce('alarm','重复',{now:10000}),false);assert.equal(voice.announce('lost','失联',{now:11000}),true);assert.equal(voice.announce('alarm','过快',{now:12000}),false);assert.equal(voice.announce('lost','提醒',{now:41000}),true);
 voice.setEnabled(false);assert.equal(voice.announce('alarm','已禁用',{force:true}),false);assert.equal(spoken.length,3);assert.ok(cancels>=5);
 assert.equal(createVoiceAlarm({}).setEnabled(true),false);
});
