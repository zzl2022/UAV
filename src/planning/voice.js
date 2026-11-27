const detectionInterval = 10_000;
const preferredNames = ['xiaoxiao', 'xiaoyi', 'yunxi', 'yunyang', 'huihui', 'kangkang', 'yaoyao', 'tingting', 'chinese', '普通话'];
const noChineseVoice = '当前浏览器没有可用的中文语音';

export function selectChineseVoice(voices) {
  const rank = voice => {
    const name = String(voice.name ?? '').toLowerCase();
    const index = preferredNames.findIndex(keyword => name.includes(keyword));
    return index < 0 ? preferredNames.length : index;
  };
  return voices.filter(voice => /^zh/i.test(voice.lang))
    .sort((a, b) => Number(!!b.localService) - Number(!!a.localService) || rank(a) - rank(b))[0] ?? null;
}

export function buildDetectionAnnouncement(telemetry) {
  const {agl, longitude, latitude} = telemetry ?? {};
  const height = Number.isFinite(agl) ? `高度 ${Math.round(agl)} 米` : '高度未知';
  const coordinates = Number.isFinite(longitude) && Number.isFinite(latitude)
    ? `东经 ${longitude.toFixed(4)} 度，北纬 ${latitude.toFixed(4)} 度` : '坐标未知';
  return `检出无人机，${height}，${coordinates}。`;
}

export function createVoiceAlarm(host = globalThis, {onState = () => {}, onError = () => {}} = {}) {
  const synth = host.speechSynthesis;
  const supported = typeof host.SpeechSynthesisUtterance === 'function' && typeof synth?.getVoices === 'function';
  let voice = null;
  let enabled = false;
  let warmed = false;
  let active = null;
  let lastSpoken = -Infinity;

  function stop() {
    lastSpoken = -Infinity;
    if (!active) return;
    active = null;
    synth.cancel();
  }

  function sync() {
    onState({supported, available: !!voice, enabled});
  }

  function refreshVoices() {
    voice = supported ? selectChineseVoice(synth.getVoices()) : null;
    if (!voice) {
      enabled = false;
      stop();
    }
    sync();
  }

  function speak(text, volume = 1) {
    if (!voice || host.document?.hidden) return false;
    active = null;
    synth.cancel();
    const utterance = new host.SpeechSynthesisUtterance(text);
    Object.assign(utterance, {voice, lang: 'zh-CN', rate: .95, pitch: 1, volume});
    const finish = error => {
      if (active !== utterance) return;
      active = null;
      if (text && error && error !== 'canceled' && error !== 'interrupted') onError();
    };
    utterance.onend = () => finish();
    utterance.onerror = event => finish(event.error);
    active = utterance;
    try {
      synth.speak(utterance);
      return true;
    } catch {
      finish('failed');
      return false;
    }
  }

  refreshVoices();
  synth?.addEventListener?.('voiceschanged', refreshVoices);
  host.document?.addEventListener?.('visibilitychange', () => {
    if (host.document.hidden) stop();
  });

  return {
    supported,
    get enabled() { return enabled; },
    get available() { return !!voice; },
    setEnabled(value) {
      enabled = Boolean(voice && value);
      if (!enabled) stop();
      else if (!warmed) {
        warmed = true;
        synth.resume?.();
        speak('', 0);
      }
      sync();
      return enabled;
    },
    stop,
    update(detected, telemetry, {now = host.performance?.now() ?? Date.now()} = {}) {
      if (!detected) {
        if (lastSpoken !== -Infinity) stop();
        return false;
      }
      if (!enabled || !voice || host.document?.hidden || now - lastSpoken < detectionInterval) return false;
      lastSpoken = now;
      return speak(buildDetectionAnnouncement(telemetry));
    },
    preview(telemetry) {
      return speak(buildDetectionAnnouncement(telemetry));
    },
  };
}

export function bindDetectionVoice({toggle, preview, status, getTarget}) {
  const voice = createVoiceAlarm(globalThis, {
    onState({supported, available, enabled}) {
      toggle.disabled = !available;
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.textContent = enabled ? '关闭语音播报' : '开启语音播报';
      preview.hidden = !supported;
      preview.disabled = !available;
      status.textContent = !available ? noChineseVoice : enabled ? '语音已启用' : '语音关闭';
    },
    onError() {
      status.textContent = '语音播放失败，请检查系统中文语音与浏览器声音设置';
    },
  });
  toggle.onclick = () => {
    if (voice.setEnabled(!voice.enabled)) {
      const {detected, telemetry} = getTarget();
      voice.update(detected, telemetry);
    }
  };
  preview.onclick = () => voice.preview(getTarget().telemetry);
  return voice;
}
