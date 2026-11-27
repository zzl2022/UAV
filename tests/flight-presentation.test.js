import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {flightTelemetry} from '../src/planning/telemetry.js';
import {buildDetectionAnnouncement,createVoiceAlarm,selectChineseVoice} from '../src/planning/voice.js';

test('telemetry respects source ENU axes and separates AGL from WGS84 model elevation',()=>{
 const {metadata}=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url)));
 const origin=flightTelemetry([0,0,0],metadata.ecefTransform,()=>-10);
 assert.ok(Math.abs(origin.longitude-metadata.origin[0])<1e-8);assert.ok(Math.abs(origin.latitude-metadata.origin[1])<1e-8);assert.ok(Math.abs(origin.elevation-metadata.origin[2])<1e-5);assert.equal(origin.agl,10);
 const east=flightTelemetry([100,100,0],metadata.ecefTransform,()=>40),north=flightTelemetry([0,0,-100],metadata.ecefTransform,()=>null);
 assert.ok(east.longitude>origin.longitude);assert.ok(north.latitude>origin.latitude);assert.equal(east.agl,60);assert.equal(north.agl,null);
 const withoutCoordinates=flightTelemetry([100,100,0],null,()=>40);
 assert.deepEqual(withoutCoordinates,{position:[100,100,0],agl:60,longitude:null,latitude:null,elevation:null});
 assert.equal(flightTelemetry([100,100,0],metadata.ecefTransform).agl,null);
});

const telemetry={agl:62.8,longitude:113.66307,latitude:34.78879};
const readout='东经 113.6631 度，北纬 34.7888 度';
const xiaoxiao={name:'Microsoft Xiaoxiao',lang:'zh-CN',localService:true};
const localChinese={name:'Local Voice',lang:'zh-CN',localService:true};
const english={name:'English',lang:'en-GB',localService:true};

test('检出播报只包含规定文案，分别处理高度和坐标缺失',()=>{
 const readings=[
  [telemetry,`检出无人机，高度 63 米，${readout}。`],
  [{...telemetry,agl:null},`检出无人机，高度未知，${readout}。`],
  [{...telemetry,latitude:undefined},'检出无人机，高度 63 米，坐标未知。'],
  [undefined,'检出无人机，高度未知，坐标未知。'],
  [{...telemetry,agl:0},`检出无人机，高度 0 米，${readout}。`],
 ];
 for(const [data,expected] of readings){
  const message=buildDetectionAnnouncement(data);
  assert.equal(message,expected);
  assert.doesNotMatch(message,/未检出|目标|报警|场景|信号暂失|离地高度/);
 }
});

test('中文语音先选本地服务，再按名称排序，最后保留第一个中文语音',()=>{
 assert.equal(selectChineseVoice([english,localChinese,xiaoxiao]),xiaoxiao);
 assert.equal(selectChineseVoice([{...xiaoxiao,localService:false},localChinese]),localChinese);
 const other={name:'First Voice',lang:'zh'};
 assert.equal(selectChineseVoice([english,other,{lang:'zh-TW'}]),other);
 assert.equal(selectChineseVoice([english]),null);
});

function speechHost(voices){
 const utterances=[],synth=new EventTarget(),document=new EventTarget();
 let speaking=null,cancels=0,resumes=0;
 document.hidden=false;
 Object.assign(synth,{
  getVoices:()=>voices,
  cancel(){cancels++;speaking=null;},
  resume(){resumes++;},
  speak(utterance){assert.equal(speaking,null);speaking=utterance;utterances.push(utterance);},
 });
 const host={speechSynthesis:synth,document,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 return {host,utterances,spoken:()=>utterances.filter(u=>u.text),get cancels(){return cancels;},get resumes(){return resumes;}};
}

test('首次检出立即播报，冷却十秒，丢失只取消，再次检出重新播报',()=>{
 const speech=speechHost([localChinese,xiaoxiao]),voice=createVoiceAlarm(speech.host);
 assert.equal(voice.enabled,false);
 assert.equal(voice.update(true,telemetry,{now:0}),false);
 assert.equal(voice.setEnabled(true),true);
 assert.equal(speech.resumes,1);
 assert.equal(speech.utterances[0].volume,0);
 assert.equal(voice.update(false,telemetry,{now:0}),false);
 assert.equal(speech.spoken().length,0);
 assert.equal(voice.update(true,telemetry,{now:1}),true);
 const [first]=speech.spoken();
 assert.equal(first.text,buildDetectionAnnouncement(telemetry));
 assert.deepEqual([first.voice,first.lang,first.rate,first.pitch,first.volume],[xiaoxiao,'zh-CN',.95,1,1]);
 assert.equal(voice.update(true,telemetry,{now:10_000}),false);
 const later={...telemetry,agl:100};
 assert.equal(voice.update(true,later,{now:10_001}),true);
 assert.equal(speech.spoken().at(-1).text,buildDetectionAnnouncement(later));
 const beforeLoss=speech.cancels;
 assert.equal(voice.update(false,undefined,{now:10_002}),false);
 assert.equal(speech.cancels,beforeLoss+1);
 assert.equal(speech.spoken().length,2);
 assert.equal(voice.update(true,telemetry,{now:10_003}),true);
 const beforeDisabled=speech.cancels;
 assert.equal(voice.setEnabled(false),false);
 assert.equal(speech.cancels,beforeDisabled+1);
 assert.equal(voice.update(true,telemetry,{now:50_000}),false);
 voice.setEnabled(true);
 assert.equal(speech.resumes,1);
});

test('语音列表异步就绪，试听支持缺失目标，页面隐藏时停止播报',()=>{
 const voices=[english],speech=speechHost(voices),voice=createVoiceAlarm(speech.host);
 assert.equal(voice.supported,true);
 assert.equal(voice.available,false);
 assert.equal(voice.setEnabled(true),false);
 assert.equal(voice.preview(telemetry),false);
 voices.push(xiaoxiao);
 speech.host.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
 assert.equal(voice.available,true);
 assert.equal(voice.preview(),true);
 assert.equal(speech.spoken().at(-1).text,'检出无人机，高度未知，坐标未知。');
 voice.setEnabled(true);
 voice.update(true,telemetry,{now:1});
 const beforeHidden=speech.cancels;
 speech.host.document.hidden=true;
 speech.host.document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(speech.cancels,beforeHidden+1);
 assert.equal(voice.preview(telemetry),false);
 assert.equal(voice.update(true,telemetry,{now:20_000}),false);
 assert.equal(createVoiceAlarm({}).setEnabled(true),false);
});
