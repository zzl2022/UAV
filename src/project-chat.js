import './project-chat.css';

const endpoint = '/api/project-chat';
const planStatusText = {
  none: '尚未生成本轮方案',
  switching: '正在切换场景',
  working: '方案正在计算',
  stale: '方案已过期，重新生成后可查询',
  ready: '已关联本轮生成的方案',
};

async function readAnswer(response, onDelta) {
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error || '项目问答请求失败，请稍后重试。');
  }
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    throw new Error('项目问答服务返回了无法识别的数据。');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    let chunk;
    while (!(chunk = await reader.read()).done) {
      pending += chunk.value;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.delta) onDelta(event.delta);
        if (event.done) return event;
      }
    }
    throw new Error('回答中断，请重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function mountProjectChat(app, getContext) {
  const root = document.createElement('div');
  root.className = 'project-chat';
  root.innerHTML = `
    <div id="project-chat-panel" class="project-chat__panel" role="dialog" aria-labelledby="project-chat-title" hidden>
      <div class="project-chat__header">
        <div><h2 id="project-chat-title">项目问答</h2><span class="project-chat__plan-status"></span></div>
        <button class="project-chat__close" type="button" aria-label="收起项目问答">×</button>
      </div>
      <div class="project-chat__thread" role="log" aria-label="对话">
        <div class="project-chat__welcome">
          <p>可以问我本轮方案、单台设备的用途或平台操作。</p>
          <button type="button" data-question disabled>本轮推荐哪套方案？</button>
          <button type="button" data-question data-device-question hidden disabled>设备-1 有什么用途？</button>
          <button type="button" data-question disabled>怎么切换场景？</button>
        </div>
      </div>
      <div class="project-chat__status" role="status"></div>
      <form class="project-chat__form">
        <textarea id="project-chat-input" aria-label="输入项目问题" placeholder="输入项目问题…" rows="2" maxlength="1200" disabled></textarea>
        <button class="project-chat__send" type="submit" disabled>发送</button>
      </form>
    </div>
    <button class="project-chat__toggle" type="button" aria-controls="project-chat-panel" aria-expanded="false">
      <span class="project-chat__icon" aria-hidden="true">···</span>项目问答
    </button>`;
  app.append(root);
  const simulationBar = app.querySelector('#ac8-simulation-bar');
  if (simulationBar) {
    const keepAboveControls = () => {
      const gap = parseFloat(getComputedStyle(simulationBar).bottom);
      root.style.setProperty('--project-chat-bottom', `${simulationBar.offsetHeight + gap + 10}px`);
    };
    new ResizeObserver(keepAboveControls).observe(simulationBar);
    keepAboveControls();
  }

  const panel = root.querySelector('.project-chat__panel');
  const toggle = root.querySelector('.project-chat__toggle');
  const close = root.querySelector('.project-chat__close');
  const thread = root.querySelector('.project-chat__thread');
  const welcome = root.querySelector('.project-chat__welcome');
  const status = root.querySelector('.project-chat__status');
  const planStatus = root.querySelector('.project-chat__plan-status');
  const form = root.querySelector('form');
  const input = root.querySelector('textarea');
  const send = root.querySelector('.project-chat__send');
  const deviceQuestion = root.querySelector('[data-device-question]');
  const questions = [...root.querySelectorAll('[data-question]')];
  let available = false;
  let checking = false;
  let active = null;
  let history = [];
  let historyContext = '';
  let previousDevice = null;
  let deviceRevision = 0;

  function showPlanStatus(state) {
    planStatus.textContent = planStatusText[state] ?? planStatusText.none;
    deviceQuestion.hidden = state !== 'ready';
  }

  function syncControls() {
    input.disabled = !available || !!active;
    send.disabled = !available || (!active && !input.value.trim());
    send.textContent = active ? '停止' : '发送';
    for (const button of questions) button.disabled = !available || !!active;
  }

  async function checkService() {
    if (checking || active) return;
    checking = true;
    status.textContent = '正在连接问答服务…';
    try {
      const response = await fetch(endpoint, {signal: AbortSignal.timeout(5000)});
      const config = await response.json();
      available = response.ok && config.available === true;
      status.textContent = available ? '' : config.error || '问答服务暂时不可用。';
    } catch {
      available = false;
      status.textContent = '问答服务未连接，请确认 Python 服务已启动。';
    } finally {
      checking = false;
      syncControls();
      if (!panel.hidden && available && document.activeElement === close) input.focus();
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      showPlanStatus(getContext().summary?.status);
      (available && !active ? input : close).focus();
      if (!available) void checkService();
    } else {
      toggle.focus();
    }
  }

  function showMessage(role, content) {
    const node = document.createElement('div');
    node.className = `project-chat__message project-chat__message--${role}`;
    node.textContent = content;
    thread.append(node);
    return node;
  }

  async function submit(event) {
    event.preventDefault();
    if (active) {
      active.abort();
      return;
    }
    const prompt = input.value.trim();
    if (!prompt || !available) return;
    const {scene, revision, summary = {status: 'none'}, lookupDevice} = getContext();
    const context = JSON.stringify([scene, revision, summary.status]);
    if (context !== historyContext) {
      history = [];
      historyContext = context;
      previousDevice = null;
    }
    const device = lookupDevice?.(prompt, previousDevice);
    const lookupRevision = deviceRevision;
    showPlanStatus(summary.status);
    const controller = new AbortController();
    active = controller;
    const message = {role: 'user', content: prompt};
    welcome.hidden = true;
    showMessage('user', prompt);
    const answer = showMessage('assistant', '');
    answer.hidden = true;
    input.value = '';
    status.textContent = '正在等待回复…';
    syncControls();
    thread.scrollTop = thread.scrollHeight;
    let reply = '';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({scene, plan: device ? {...summary, device} : summary, messages: [...history, message]}),
        signal: controller.signal,
      });
      const result = await readAnswer(response, delta => {
        const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
        reply += delta;
        answer.hidden = false;
        answer.textContent = reply;
        status.textContent = '正在回复…';
        if (nearBottom) thread.scrollTop = thread.scrollHeight;
      });
      if (!reply.trim()) throw new Error('问答服务返回了空回答，请重试。');
      history = [...history, message, {role: 'assistant', content: reply.slice(0, 8000)}].slice(-8);
      previousDevice = device?.status === 'found' && lookupRevision === deviceRevision
        ? {planId: device.planId, number: device.number, viewPlanId: summary.activePlanId}
        : null;
      status.textContent = result.truncated ? '回答已达长度上限，可以继续追问。' : '';
    } catch (error) {
      if (controller.signal.aborted) {
        status.textContent = '已停止回复。';
      } else {
        status.textContent = error instanceof TypeError ? '连接中断，请重试。' : error.message;
        input.value = prompt;
      }
    } finally {
      active = null;
      syncControls();
      if (!panel.hidden && (document.activeElement === send || document.activeElement === document.body)) {
        input.focus();
      }
    }
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  app.addEventListener('project-chat-plan-status', event => {
    showPlanStatus(event.detail);
    if (event.detail !== 'ready') {
      previousDevice = null;
      deviceRevision++;
    }
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  });
  input.addEventListener('input', syncControls);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', submit);
  for (const button of questions) {
    button.addEventListener('click', () => {
      input.value = button.textContent.trim();
      form.requestSubmit();
    });
  }
}
