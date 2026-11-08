import './scene-menu.css';

/**
 * AC8-style secondary scene menu. It reuses the existing city-conditions tabs
 * and pages (scene / environment / target) but presents them as glowing text
 * options beside a bent HUD line instead of a floating window.
 *
 * Level 1 — the three sidebar launchers slide off-screen while a glow line is
 *           drawn from the "场景设定" label: horizontal first, then downward.
 * Level 2 — 场景选择 / 环境情况 / 侦测目标 are stacked beside the vertical
 *           segment. Choosing one slides them out and reveals the original
 *           settings rows one after another.
 * Level 3 — back / Esc returns from a detail page to level 2; a second back
 *           returns to level 1 (the sidebar launchers).
 */
export function mountSceneMenu({app, launchers, panel, workspace, camera, renderer, getInfo}) {
  if (!app || !launchers || !panel) return null;
  const tabs = panel.querySelector('.city-mode-tabs');
  if (!tabs) return null;
  const tabButtons = [...tabs.children];
  const pages = [...panel.querySelectorAll('.city-page')];
  const launcher = app.querySelector('#open-city-model');
  const cityWindow = app.querySelector('#city-window');

  const menu = document.createElement('div');
  menu.id = 'ac8-scene-menu';
  menu.setAttribute('aria-hidden', 'true');
  menu.innerHTML = `
    <svg class="ac8-scene-line" aria-hidden="true">
      <path class="ac8-scene-line-glow"></path>
      <path class="ac8-scene-line-core"></path>
    </svg>
    <div class="ac8-scene-options"></div>
    <div id="ac8-scene-content"></div>
    <button id="ac8-scene-back" type="button"><span aria-hidden="true">‹</span>返回</button>`;
  app.appendChild(menu);

  const options = menu.querySelector('.ac8-scene-options');
  const content = menu.querySelector('#ac8-scene-content');
  const back = menu.querySelector('#ac8-scene-back');
  const glowPath = menu.querySelector('.ac8-scene-line-glow');
  const corePath = menu.querySelector('.ac8-scene-line-core');

  options.appendChild(tabs);
  content.appendChild(panel);
  panel.hidden = false;
  panel.removeAttribute('hidden');
  tabs.classList.add('ac8-scene-tabs');
  document.body.classList.add('scene-menu-enabled', 'hud-menu-enabled');
  if (cityWindow) cityWindow.classList.add('scene-menu-retired');
  pages.forEach(page => { page.hidden = true; });

  // Compact live readout under the three main entries.
  const info = document.createElement('section');
  info.className = 'ac8-scene-info';
  info.setAttribute('aria-label', '当前场景信息');
  info.innerHTML = `
    <div class="ac8-info-row"><span class="ac8-info-label">[区域]</span><span class="ac8-info-value" data-info="area">—</span></div>
    <div class="ac8-info-row"><span class="ac8-info-label">[坐标]</span><span class="ac8-info-value" data-info="coordinates">—</span></div>
    <div class="ac8-info-row"><span class="ac8-info-label">[采用装备]</span><span class="ac8-info-value" data-info="equipment">—</span></div>
    <div class="ac8-info-row"><span class="ac8-info-label">[采用方案]</span><span class="ac8-info-value" data-info="plan">—</span></div>`;
  const sidebar = launchers.parentElement;
  sidebar.appendChild(info);
  const mainToggleButton = app.querySelector('#ac8-main-menu-toggle');
  function positionInfo() {
    const collapsed = launchers.classList.contains('is-main-collapsed');
    const anchor = collapsed ? mainToggleButton : launchers.lastElementChild;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const base = sidebar.getBoundingClientRect();
    info.style.top = `${Math.round(rect.bottom - base.top + (collapsed ? 12 : 14))}px`;
    info.classList.toggle('is-raised', collapsed);
  }
  positionInfo();
  new MutationObserver(positionInfo).observe(launchers, {attributes: true, attributeFilter: ['class']});
  window.addEventListener('resize', positionInfo);
  window.addEventListener('scroll', positionInfo, true);
  const infoValues = {
    area: info.querySelector('[data-info="area"]'),
    coordinates: info.querySelector('[data-info="coordinates"]'),
    equipment: info.querySelector('[data-info="equipment"]'),
    plan: info.querySelector('[data-info="plan"]'),
  };
  function refreshInfo() {
    if (!getInfo) return;
    let values;
    try { values = getInfo(); } catch { return; }
    if (!values) return;
    for (const [key, node] of Object.entries(infoValues)) {
      const next = values[key] ?? '—';
      if (node && node.textContent !== next) node.textContent = next;
    }
  }
  refreshInfo();
  window.setInterval(refreshInfo, 900);
  app.addEventListener('view-change', refreshInfo);
  document.addEventListener('change', refreshInfo, true);
  window.addEventListener('ac8-main-menu-toggle', () => { positionInfo(); });

  let open = false;
  let detail = false;
  let minimized = false;
  let origin = null;
  let sceneShift = 0;
  let shiftFrame = 0;
  let returnTimer = 0;

  // Slide the rendered model toward the right half of the viewport by shifting
  // the camera's projection window while the menu is open.
  function applySceneShift(value) {
    if (!camera || !renderer) return;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (value <= .0005) {
      camera.clearViewOffset?.();
      return;
    }
    camera.setViewOffset(width, height, -width * value, 0, width, height);
    camera.updateProjectionMatrix();
  }

  function animateSceneShift(target, duration = 1050) {
    if (!camera || !renderer) return;
    cancelAnimationFrame(shiftFrame);
    const from = sceneShift;
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      sceneShift = from + (target - from) * eased;
      applySceneShift(sceneShift);
      if (t < 1) shiftFrame = requestAnimationFrame(step);
    };
    shiftFrame = requestAnimationFrame(step);
  }

  function sceneShiftTarget() {
    const width = window.innerWidth;
    if (width < 720) return .1;
    if (width < 1200) return .15;
    return .24;
  }

  function measureOrigin() {
    if (origin) return origin;
    // Use layout offsets, not getBoundingClientRect: the launcher is translated
    // while it slides off-screen and could be measured mid-transition.
    const parent = launcher?.offsetParent || app;
    if (launcher) {
      const base = parent.getBoundingClientRect();
      origin = {
        x: base.left + launcher.offsetLeft + launcher.offsetWidth + 4,
        y: base.top + launcher.offsetTop + launcher.offsetHeight / 2,
        left: base.left + launcher.offsetLeft,
        top: base.top + launcher.offsetTop,
      };
    } else {
      origin = {x: 180, y: 165, left: 30, top: 145};
    }
    return origin;
  }

  function layout() {
    const start = measureOrigin();
    menu.style.setProperty('--ac8-options-left', `${start.left}px`);
    menu.style.setProperty('--ac8-options-top', `${start.top}px`);
    const optionWidth = tabButtons.reduce((max, button) => Math.max(max, button.offsetWidth), 0) || 110;
    const optionsRight = start.left + optionWidth;
    // The vertical segment sits just beyond the longest option label. It is
    // final position; the whole line is translated left initially and slides
    // right in step with the departing main menu (see .ac8-scene-line).
    const bend = Math.min(
      Math.max(optionsRight + 56, start.x + 18),
      window.innerWidth - 36,
    );
    for (const button of tabButtons) {
      button.style.setProperty('--ac8-tick', `${Math.max(14, bend - start.left - button.offsetWidth - 7)}px`);
    }
    const span = Math.min(520, Math.max(300, window.innerHeight * 0.58));
    const bottom = Math.min(start.y + span, window.innerHeight - 104);
    const d = `M ${start.x} ${start.y} H ${bend} V ${bottom}`;
    glowPath.setAttribute('d', d);
    corePath.setAttribute('d', d);
    const length = (bend - start.x) + (bottom - start.y);
    glowPath.style.strokeDasharray = String(length);
    corePath.style.strokeDasharray = String(length);
    menu.style.setProperty('--ac8-line-x', `${start.x}px`);
    menu.style.setProperty('--ac8-line-y', `${start.y}px`);
    menu.style.setProperty('--ac8-bend-x', `${bend}px`);
    menu.style.setProperty('--ac8-bottom', `${bottom}px`);
    setLineProgress(open ? 1 : 0);
  }

  function setLineProgress(progress) {
    const length = Number.parseFloat(corePath.style.strokeDasharray) || 0;
    const offset = String(length * (1 - progress));
    glowPath.style.strokeDashoffset = offset;
    corePath.style.strokeDashoffset = offset;
  }

  function pageFor(id) {
    return id === 'scene' ? panel.querySelector('#city-scene-page') : panel.querySelector(`#city-${id}-page`);
  }

  function animatePage(page) {
    if (!page) return;
    const isScene = page.id === 'city-scene-page';
    const rows = isScene
      ? [...page.children].filter(node => !node.hidden)
      : [
          page.querySelector(':scope > h2'),
          ...page.querySelectorAll('.city-settings-nav > *, .profile-field-grid > *, .city-target-actions > *, .city-settings-footer > *'),
        ].filter(Boolean);
    rows.forEach((element, index) => {
      element.style.animation = 'none';
      void element.offsetWidth;
      element.style.animation = '';
      element.style.animationDelay = `${Math.min(index, 26) * 46}ms`;
    });
    page.classList.remove('ac8-page-anim');
    void page.offsetWidth;
    page.classList.add('ac8-page-anim');
  }

  function clearPageAnimation() {
    pages.forEach(page => {
      page.hidden = true;
      page.classList.remove('ac8-page-anim');
      page.querySelectorAll('[style*="animation-delay"]').forEach(node => { node.style.animationDelay = ''; });
    });
    tabButtons.forEach((button, index) => {
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = index === 0 ? 0 : -1;
    });
  }

  function openMenu() {
    if (open) return;
    window.__ac8HudMenus?.forEach(other => { if (other.kind !== 'scene') other.close(); });
    origin = null;
    layout();
    setLineProgress(0);
    open = true;
    detail = false;
    minimized = false;
    window.clearTimeout(returnTimer);
    clearPageAnimation();
    tabs.inert = false;
    menu.classList.remove('is-detail', 'is-minimized', 'is-returning');
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    launcher?.setAttribute('aria-expanded', 'true');
    if (workspace) {
      for (const id of ['equipment', 'deployment']) workspace.closeWindow(id);
    }
    app.dispatchEvent(new CustomEvent('view-change', {detail: 'city'}));
    launchers.classList.add('is-scene-hidden');
    document.body.classList.add('scene-menu-open', 'hud-menu-open');
    animateSceneShift(sceneShiftTarget(), 1100);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setLineProgress(1));
    });
    window.setTimeout(() => {
      if (open && !detail && !minimized) tabButtons[0]?.focus({preventScroll: true});
    }, 680);
  }

  function enterDetail(id) {
    if (!open || detail || minimized) return;
    detail = true;
    tabs.inert = true;
    menu.classList.add('is-detail');
    const page = pageFor(id);
    pages.forEach(item => { if (item !== page) item.hidden = true; });
    if (page) {
      page.hidden = false;
      animatePage(page);
    }
    back.focus({preventScroll: true});
  }

  function exitDetail() {
    if (!open || !detail) return;
    detail = false;
    tabs.inert = false;
    menu.classList.remove('is-detail');
    menu.classList.add('is-returning');
    window.clearTimeout(returnTimer);
    returnTimer = window.setTimeout(() => menu.classList.remove('is-returning'), 700);
    clearPageAnimation();
    if (!minimized) tabButtons[0]?.focus({preventScroll: true});
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    detail = false;
    minimized = false;
    const hadFocus = menu.contains(document.activeElement);
    tabs.inert = false;
    setLineProgress(0);
    menu.classList.remove('is-open', 'is-detail', 'is-minimized');
    menu.setAttribute('aria-hidden', 'true');
    launcher?.setAttribute('aria-expanded', 'false');
    launchers.classList.remove('is-scene-hidden');
    document.body.classList.remove('scene-menu-open', 'hud-menu-open');
    animateSceneShift(0, 850);
    clearPageAnimation();
    if (hadFocus) launcher?.focus({preventScroll: true});
  }

  function backAction() {
    if (!open) return;
    if (minimized) { restore(); return; }
    if (detail) exitDetail();
    else closeMenu();
  }

  // Used while picking a target on the map: the overlay must not swallow the
  // click, but the menu level is remembered and restored afterwards.
  function minimize() {
    if (!open) return;
    minimized = true;
    menu.classList.add('is-minimized');
    animateSceneShift(0, 520);
  }

  function restore() {
    if (!minimized) return;
    minimized = false;
    menu.classList.remove('is-minimized');
    layout();
    animateSceneShift(sceneShiftTarget(), 760);
    if (open) {
      if (detail) {
        const selected = tabButtons.find(button => button.getAttribute('aria-selected') === 'true');
        if (selected) enterDetail(selected.dataset.page);
      } else {
        tabButtons[0]?.focus({preventScroll: true});
      }
    }
  }

  // The launcher now opens the HUD menu instead of the retired window.
  if (launcher) {
    launcher.setAttribute('aria-controls', 'ac8-scene-menu');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-haspopup', 'true');
    launcher.onclick = event => {
      event.preventDefault();
      if (open) backAction();
      else openMenu();
    };
  }

  // Top-left control that tucks the three main entries away.
  const mainToggle = app.querySelector('#ac8-main-menu-toggle');
  let mainCollapsed = false;
  function syncMainToggle() {
    if (!mainToggle) return;
    const glyph = mainToggle.querySelector('span');
    if (glyph) glyph.textContent = mainCollapsed ? '»' : '«';
    mainToggle.setAttribute('aria-expanded', String(!mainCollapsed));
    const label = mainCollapsed ? '展开主菜单' : '收起主菜单';
    mainToggle.title = label;
    mainToggle.setAttribute('aria-label', label);
  }
  if (mainToggle) {
    mainToggle.onclick = () => {
      mainCollapsed = !mainCollapsed;
      launchers.classList.toggle('is-main-collapsed', mainCollapsed);
      syncMainToggle();
      window.dispatchEvent(new CustomEvent('ac8-main-menu-toggle', {detail: {collapsed: mainCollapsed}}));
    };
    syncMainToggle();
  }

  // Chain the existing tab activation so the detail animation runs after the
  // city-conditions page switch.
  for (const button of tabButtons) {
    const previous = button.onclick;
    button.onclick = () => {
      previous?.();
      enterDetail(button.dataset.page);
    };
  }

  back.onclick = backAction;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open && !event.defaultPrevented) {
      event.preventDefault();
      event.stopImmediatePropagation();
      backAction();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open && !detail) {
      const current = tabButtons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + tabButtons.length) % tabButtons.length;
      tabButtons[next].focus({preventScroll: true});
    }
  }, true);

  window.addEventListener('resize', () => {
    if (!open) return;
    origin = null;
    layout();
    origin = null;
    animateSceneShift(sceneShiftTarget(), 260);
  });

  // Keep the original city window from ever being shown by other code paths.
  if (cityWindow) cityWindow.addEventListener('cancel', event => event.preventDefault());

  const api = {
    open: openMenu,
    close: closeMenu,
    back: backAction,
    minimize,
    restore,
    isOpen: () => open,
    isDetail: () => detail,
    isMinimized: () => minimized,
    sceneShift: () => sceneShift,
    layout,
  };
  window.__ac8SceneMenu = api;
  window.__ac8HudMenus = window.__ac8HudMenus ?? [];
  window.__ac8HudMenus.push({kind: 'scene', close: closeMenu, isOpen: () => open});
  return api;
}
