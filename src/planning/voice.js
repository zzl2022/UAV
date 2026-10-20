// Speech stays opt-in and bounded: replace stale utterances, never queue replay history.
export function createVoiceAlarm(host=globalThis){
 const supported=!!host.speechSynthesis&&typeof host.SpeechSynthesisUtterance==='function';
 let enabled=false,lastKey=null,lastTime=-Infinity;
 const stop=()=>{if(supported)host.speechSynthesis.cancel();};
 return {supported,get enabled(){return enabled;},setEnabled(value){enabled=supported&&value;stop();lastKey=null;lastTime=-Infinity;return enabled;},stop,
  announce(key,text,{force=false,now=Date.now()}={}){
   if(!enabled)return false;
   if(!force&&(now-lastTime<5000||(key===lastKey&&now-lastTime<30000)))return false;
   stop();const utterance=new host.SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=1;
   const voices=host.speechSynthesis.getVoices(),chinese=voices.filter(v=>/^zh(?:-|_)/i.test(v.lang));utterance.voice=chinese.find(v=>v.localService)||chinese[0]||null;
   utterance.onerror=event=>{if(!['canceled','interrupted'].includes(event.error))host.dispatchEvent?.(new host.CustomEvent('flight-voice-error',{detail:event.error}));};
   host.speechSynthesis.speak(utterance);lastKey=key;lastTime=now;return true;
  }
 };
}
