import assert from 'node:assert/strict';

export async function mockBrowserSpeech(page,{withChinese=true}={}){
 await page.addInitScript(withChinese=>{
  const voices=[{name:'Test English',lang:'en-US',localService:true}];
  const chinese=[{name:'Test Chinese',lang:'zh-CN',localService:true},{name:'Test Xiaoxiao',lang:'zh-CN',localService:true}];
  if(withChinese)voices.push(...chinese);
  const synth=new EventTarget();
  window.testSpeech=[];window.testSpeechCancels=0;
  window.loadTestChineseVoices=()=>{voices.push(...chinese);synth.dispatchEvent(new Event('voiceschanged'));};
  Object.assign(synth,{
   cancel(){window.testSpeechCancels++;},
   getVoices:()=>voices,
   speak:utterance=>{
    if(utterance.volume>0)window.testSpeech.push({text:utterance.text,lang:utterance.lang,rate:utterance.rate,
      pitch:utterance.pitch,volume:utterance.volume,voice:utterance.voice.name});
   },
  });
  Object.defineProperty(window,'speechSynthesis',{value:synth});
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 },withChinese);
}

export function assertDetectionSpeech(spoken){
 assert.ok(spoken.text.includes('检出无人机')&&spoken.text.includes('高度'));
 assert.doesNotMatch(spoken.text,/未检出|目标 D|报警|场景|离地高度|信号暂失/);
 assert.match(spoken.text,/^检出无人机，高度 (-?\d+) 米，东经 -?\d+\.\d{4} 度，北纬 -?\d+\.\d{4} 度。$/);
 assert.deepEqual([spoken.lang,spoken.rate,spoken.pitch,spoken.volume,spoken.voice],['zh-CN',.95,1,1,'Test Xiaoxiao']);
}
