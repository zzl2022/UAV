import './ui-toast.css';

const ICONS={success:'✓',info:'i',error:'!'};
const DEFAULT_DURATION=3000;
const MAX_VISIBLE=3;

export function mountUiToast(root){
  const stack=document.createElement('div');
  stack.className='ui-toast-stack';
  stack.setAttribute('role','status');
  stack.setAttribute('aria-live','polite');
  stack.setAttribute('aria-atomic','false');
  root.append(stack);
  const visible=new Map();

  function dismiss(text){
    const notice=visible.get(text);
    if(!notice)return;
    window.clearTimeout(notice.timer);
    notice.card.remove();
    visible.delete(text);
  }

  return function toast(text,{tone='success',duration=DEFAULT_DURATION}={}){
    if(!text)return;
    const effectiveTone=Object.hasOwn(ICONS,tone)?tone:'info';
    let notice=visible.get(text);
    if(notice){
      window.clearTimeout(notice.timer);
      visible.delete(text);
    }else{
      if(visible.size>=MAX_VISIBLE)dismiss(visible.keys().next().value);
      const card=document.createElement('div');
      card.className='ui-toast';
      const icon=document.createElement('span');
      icon.className='ui-toast-icon';
      icon.setAttribute('aria-hidden','true');
      const message=document.createElement('span');
      message.textContent=text;
      card.append(icon,message);
      notice={card,icon,timer:0};
    }
    notice.card.dataset.tone=effectiveTone;
    notice.icon.textContent=ICONS[effectiveTone];
    stack.append(notice.card);
    const delay=Number.isFinite(duration)?Math.min(5000,Math.max(2000,duration)):DEFAULT_DURATION;
    notice.timer=window.setTimeout(()=>dismiss(text),delay);
    visible.set(text,notice);
  };
}
