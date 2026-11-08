import './hud-menu.css';

/**
 * Shared AC8-style secondary menu used by 反无设备 and 推演部署.
 *
 * It mirrors the scene-settings menu: the three main labels slide off to the
 * right, a glow line bends down from the selected launcher, the sub-entries
 * appear beside the vertical segment, and the chosen panel opens row by row.
 * Pressing Esc / 返回 walks back from the detail panel to the entries, then
 * closes the menu entirely.
 */
export function mountHudMenu(options) {
  const {
    app, launchers, kind, launcher, panel,
    entries = [],
    contentClass = '',
    onOpen, onClose, onSelect, onDetailExit,
  } = options || {};
  if (!app || !launchers || !launcher || !panel || !entries.length) return null;

  const root = document.createElement('div');
  root.id = `ac8-${kind}-menu`;
  root.className = 'ac8-hud-menu';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <svg class="ac8-hud-line" aria-hidden="true">
      <path class="ac8-hud-line-glow"></path>
      <path class="ac8-hud-line-core"></path>
    </svg>
    <div class="ac8-hud-options"><div class="ac8-hud-tabs" role="tablist"></div></div>
    <div class="ac8-hud-content ${contentClass}"></div>
    <button class="ac8-hud-back" type="button"><span aria-hidden="true">‹</span>返回</button>`;
  app.appendChild(root);

  const optionsBox = root.querySelector('.ac8-hud-options');
  const tabs = root.querySelector('.ac8-hud-tabs');
  const content = root.querySelector('.ac8-hud-content');
  const back = root.querySelector('.ac8-hud-back');
  const glowPath = root.querySelector('.ac8-hud-line-glow');
  const corePath = root.querySelector('.ac8-hud-line-core');

  const buttons = entries.map(({id, label}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.page = id;
    button.textContent = label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.onclick = () => enterDetail(id);
    tabs.append(button);
    return button;
  });
  tabs.setAttribute('aria-label', kind === 'equipment' ? '设备类型' : '推演部署');

  content.appendChild(panel);
  panel.hidden = false;
  panel.removeAttribute('hidden');
  content.classList.add(`is-${kind}`);
  document.body.classList.add('hud-menu-enabled');

  let open = false;
  let detail = false;
  let active = null;
  let origin = null;

  function measureOrigin() {
    if (origin) return origin;
    const parent = launcher.offsetParent || app;
    const base = parent.getBoundingClientRect();
    origin = {
      x: base.left + launcher.offsetLeft + launcher.offsetWidth + 4,
      y: base.top + launcher.offsetTop + launcher.offsetHeight / 2,
      left: base.left + launcher.offsetLeft,
      top: base.top + launcher.offsetTop,
    };
    return origin;
  }

  function layout() {
    const start = measureOrigin();
    root.style.setProperty('--ac8-options-left', `${start.left}px`);
    root.style.setProperty('--ac8-options-top', `${start.top}px`);
    const optionWidth = buttons.reduce((max, button) => Math.max(max, button.offsetWidth), 0) || 110;
    const bend = Math.min(Math.max(start.left + optionWidth + 56, start.x + 18), window.innerWidth - 36);
    const desired = kind === 'deployment'
      ? Math.max(560, window.innerHeight - 150)
      : Math.max(520, buttons.length * 54 + 90);
    const span = Math.min(desired, Math.max(360, window.innerHeight - 150));
    const bottom = Math.min(start.y + span, window.innerHeight - 104);
    const d = `M ${start.x} ${start.y} H ${bend} V ${bottom}`;
    glowPath.setAttribute('d', d);
    corePath.setAttribute('d', d);
    const length = (bend - start.x) + (bottom - start.y);
    glowPath.style.strokeDasharray = String(length);
    corePath.style.strokeDasharray = String(length);
    for (const button of buttons) {
      button.style.setProperty('--ac8-tick', `${Math.max(14, bend - start.left - button.offsetWidth - 7)}px`);
    }
    root.style.setProperty('--ac8-line-x', `${start.x}px`);
    root.style.setProperty('--ac8-line-y', `${start.y}px`);
    root.style.setProperty('--ac8-bend-x', `${bend}px`);
    root.style.setProperty('--ac8-bottom', `${bottom}px`);
    setLineProgress(open ? 1 : 0);
  }

  function setLineProgress(progress) {
    const length = Number.parseFloat(corePath.style.strokeDasharray) || 0;
    const offset = String(length * (1 - progress));
    glowPath.style.strokeDashoffset = offset;
    corePath.style.strokeDashoffset = offset;
  }

  function animateRows() {
    const rows = kind === 'equipment'
      ? [...panel.querySelectorAll('#equipment-manager > *')]
      : [...panel.querySelectorAll('#deployment-panel > #deployment-panels > *')];
    rows.forEach((element, index) => {
      element.style.animation = 'none';
      void element.offsetWidth;
      element.style.animation = '';
      element.style.animationDelay = `${Math.min(index, 18) * 50}ms`;
    });
    const host = kind === 'equipment' ? panel.querySelector('#equipment-manager') : panel.querySelector('#deployment-panels');
    if (!host) return;
    host.classList.remove('ac8-hud-anim');
    void host.offsetWidth;
    host.classList.add('ac8-hud-anim');
  }

  function openMenu() {
    if (open) return;
    window.__ac8HudMenus?.forEach(other => { if (other.kind !== kind) other.close(); });
    origin = null;
    layout();
    setLineProgress(0);
    open = true;
    detail = false;
    active = null;
    root.classList.remove('is-detail');
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    launcher.setAttribute('aria-expanded', 'true');
    launchers.classList.add('is-scene-hidden');
    document.body.classList.add('hud-menu-open');
    buttons.forEach(button => button.setAttribute('aria-selected', 'false'));
    onOpen?.();
    requestAnimationFrame(() => requestAnimationFrame(() => setLineProgress(1)));
    window.setTimeout(() => {
      if (open && !detail) buttons[0]?.focus({preventScroll: true});
    }, 720);
  }

  function enterDetail(id) {
    if (!open) return;
    // While a panel is already open, another entry switches it directly.
    if (detail && active !== id) {
      active = id;
      buttons.forEach(button => button.setAttribute('aria-selected', String(button.dataset.page === id)));
      onSelect?.(id, {panel, content});
      animateRows();
      return;
    }
    if (detail) return;
    detail = true;
    active = id;
    root.classList.add('is-detail');
    buttons.forEach(button => button.setAttribute('aria-selected', String(button.dataset.page === id)));
    onSelect?.(id, {panel, content});
    requestAnimationFrame(() => {
      if (detail && active === id) animateRows();
    });
    back.focus({preventScroll: true});
  }

  function exitDetail() {
    if (!open || !detail) return;
    detail = false;
    active = null;
    root.classList.remove('is-detail');
    buttons.forEach(button => button.setAttribute('aria-selected', 'false'));
    onDetailExit?.();
    if (open) buttons[0]?.focus({preventScroll: true});
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    detail = false;
    active = null;
    setLineProgress(0);
    root.classList.remove('is-open', 'is-detail');
    root.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    launchers.classList.remove('is-scene-hidden');
    document.body.classList.remove('hud-menu-open');
    buttons.forEach(button => button.setAttribute('aria-selected', 'false'));
    onClose?.();
  }

  function backAction() {
    if (!open) return;
    if (detail) exitDetail();
    else closeMenu();
  }

  launcher.onclick = event => {
    event.preventDefault();
    if (open) backAction();
    else openMenu();
  };
  launcher.setAttribute('aria-controls', root.id);
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-haspopup', 'true');
  back.onclick = backAction;

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open && !event.defaultPrevented) {
      // Let the equipment model popover handle its own Escape first.
      if (event.target?.closest?.('#equipment-model-menu')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      backAction();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open && !detail) {
      const current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus({preventScroll: true});
    }
  }, true);

  window.addEventListener('resize', () => {
    if (!open) return;
    origin = null;
    layout();
    origin = null;
  });

  function openDetail(id) {
    if (!open) openMenu();
    if (detail && active !== id) exitDetail();
    if (!detail) enterDetail(id);
  }

  const api = {
    kind,
    open: openMenu,
    openDetail,
    close: closeMenu,
    back: backAction,
    isOpen: () => open,
    isDetail: () => detail,
    active: () => active,
    layout,
  };
  window.__ac8HudMenus = window.__ac8HudMenus ?? [];
  window.__ac8HudMenus.push({kind, close: closeMenu, isOpen: () => open});
  window[`__ac8${kind[0].toUpperCase()}${kind.slice(1)}Menu`] = api;
  return api;
}
