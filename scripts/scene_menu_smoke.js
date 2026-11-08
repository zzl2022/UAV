import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const outDir = 'artifacts/scene-menu';
let page;
try {
  await mkdir(outDir, {recursive: true});
  page = await browser.newPage({viewport: {width: 1600, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon/i.test(msg.text())) errors.push(`console: ${msg.text()}`); });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon/i.test(response.url())) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}?intro=0`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, {timeout: 120000});
  await page.waitForTimeout(700);
  await page.screenshot({path: `${outDir}/01-launchers.png`});

  assert.equal(await page.locator('#city-window').isVisible(), false, 'original window is retired');
  assert.equal(await page.evaluate(() => document.querySelector('#status').hidden), true, 'completion toast is removed');

  // Live scene readout under the main entries.
  const infoPanel = page.locator('.ac8-scene-info');
  assert.equal(await infoPanel.locator('[data-info]').count(), 4);
  assert.equal(await page.locator('.ac8-info-label').first().textContent(), '[区域]');
  assert.equal(await page.locator('[data-info="area"]').textContent(), '河南博物院');
  assert.ok((await page.locator('[data-info="coordinates"]').textContent()).includes('东经'));
  assert.ok((await page.locator('[data-info="equipment"]').textContent()).includes('02C'));
  await page.screenshot({path: `${outDir}/01-launchers.png`});

  // Main-menu collapse control at the top-left.
  const mainToggle = page.locator('#ac8-main-menu-toggle');
  const infoTopBefore = await infoPanel.evaluate(el => el.getBoundingClientRect().top);
  await mainToggle.click();
  await page.waitForFunction(() => document.querySelector('.ac8-scene-info').classList.contains('is-raised'), null, {timeout: 4000});
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.workspace-launchers').evaluate(el => el.classList.contains('is-main-collapsed')), true);
  assert.equal(await mainToggle.getAttribute('aria-expanded'), 'false');
  assert.ok(Number(await infoPanel.evaluate(el => getComputedStyle(el).opacity)) > .5, 'info stays visible when the main menu collapses');
  const infoTopRaised = await infoPanel.evaluate(el => el.getBoundingClientRect().top);
  assert.ok(infoTopRaised < infoTopBefore - 40, 'info moves up to the top-left');
  await page.screenshot({path: `${outDir}/00-collapsed.png`});
  await mainToggle.click();
  await page.waitForFunction(() => !document.querySelector('.ac8-scene-info').classList.contains('is-raised'), null, {timeout: 4000});
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.workspace-launchers').evaluate(el => el.classList.contains('is-main-collapsed')), false);
  assert.equal(await mainToggle.getAttribute('aria-expanded'), 'true');
  assert.ok(Number(await infoPanel.evaluate(el => getComputedStyle(el).opacity)) > .5);

  await page.locator('#open-city-model').click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#ac8-scene-menu').getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('#ac8-scene-tabs, .ac8-scene-tabs').count(), 1);
  assert.equal(await page.locator('.ac8-scene-tabs button').count(), 3);
  for (const label of ['区域选择', '环境情况', '侦测目标']) {
    assert.equal(await page.locator('.ac8-scene-tabs button', {hasText: label}).count(), 1, `${label} option`);
  }
  assert.equal(await page.locator('.workspace-launchers').evaluate(el => el.classList.contains('is-scene-hidden')), true);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.ac8-scene-info')).opacity) < .05, null, {timeout: 4000});
  assert.ok(await page.evaluate(() => window.__ac8SceneMenu.sceneShift()) > .2, 'model slides to the right half');
  await page.screenshot({path: `${outDir}/02-options.png`});

  // Detail level: environment page.
  await page.locator('.ac8-scene-tabs button', {hasText: '环境情况'}).click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#city-environment-page').isVisible(), true);
  assert.equal(await page.locator('#city-environment-page .profile-field-grid > *').first().isVisible(), true);
  await page.screenshot({path: `${outDir}/03-environment.png`});

  // Esc returns to the option level.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen() && !window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#city-environment-page').isVisible(), false);
  await page.screenshot({path: `${outDir}/04-back-to-options.png`});

  // Second Esc returns to the main launcher menu.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('.workspace-launchers').evaluate(el => el.classList.contains('is-scene-hidden')), false);
  assert.equal(await page.locator('#city-window').isVisible(), false);
  assert.ok(await page.evaluate(() => window.__ac8SceneMenu.sceneShift()) < .01, 'model returns to center');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.ac8-scene-info')).opacity) > .5, null, {timeout: 4000});
  await page.screenshot({path: `${outDir}/05-closed.png`});

  // Scene page + back button.
  await page.locator('#open-city-model').click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(900);
  await page.locator('.ac8-scene-tabs button', {hasText: '区域选择'}).click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#city-scene-page').isVisible(), true);
  assert.equal(await page.locator('#model-select').isVisible(), true);
  await page.screenshot({path: `${outDir}/06-scene.png`});
  await page.locator('#ac8-scene-back').click();
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.locator('#ac8-scene-back').click();
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(1000);

  // Target page.
  await page.locator('#open-city-model').click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(240);
  await page.locator('.ac8-scene-tabs button', {hasText: '侦测目标'}).click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#city-target-page').isVisible(), true);
  await page.screenshot({path: `${outDir}/07-target.png`});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isDetail(), null, {timeout: 3000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(1100);

  // 反无设备: same HUD form, full map until a type is picked.
  await page.locator('#toggle-sensors').click();
  await page.waitForFunction(() => window.__ac8EquipmentMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('#equipment-window').isVisible(), false, 'legacy equipment window is retired');
  assert.equal(await page.locator('#ac8-equipment-menu .ac8-hud-tabs button').count(), 6);
  assert.ok(Number(await page.locator('#ac8-equipment-menu .ac8-hud-content').evaluate(el => getComputedStyle(el).opacity)) < .05, 'equipment content waits for a type');
  await page.screenshot({path: `${outDir}/08-equipment-options.png`});
  await page.locator('#ac8-equipment-menu .ac8-hud-tabs button', {hasText: '雷达'}).click();
  await page.waitForFunction(() => window.__ac8EquipmentMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('#equipment-manager').isVisible(), true);
  assert.equal(await page.locator('#equipment-tab-radar').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#equipment-demo-hud').isVisible(), false, 'demo readout stays hidden after auto start');
  assert.equal(await page.locator('#equipment-demo-details').isVisible(), true, '仿真详情 button is in the heading');
  await page.screenshot({path: `${outDir}/09-equipment-radar.png`});
  // Switching to another radar model (same type) restarts the demo automatically.
  await page.getByRole('button',{name:'选择雷达型号',exact:true}).click();
  await page.locator('#equipment-model-menu [data-preset-id="radar-03d"]').click();
  await page.waitForFunction(() => window.equipmentDemoDiagnostics?.presetId === 'radar-03d', null, {timeout: 10000});
  assert.match(await page.locator('#equipment-model-name').innerText(), /03D/);
  // 仿真详情 slides the settings menu left and reveals the demo readout.
  await page.locator('#equipment-demo-details').click();
  await page.waitForFunction(() => document.querySelector('#ac8-equipment-menu')?.classList.contains('is-demo-details'), null, {timeout: 4000});
  await page.waitForFunction(() => {
    const content = document.querySelector('#ac8-equipment-menu .ac8-hud-content');
    const hud = document.querySelector('#equipment-demo-hud');
    return content && hud && getComputedStyle(content).visibility === 'hidden' && !hud.hidden && Number(getComputedStyle(hud).opacity) > .9;
  }, null, {timeout: 20000});
  assert.equal(await page.locator('#equipment-demo-hud [data-demo-action="back"]').isVisible(), true);
  // The former 鼠标位置 · 信号估计 window is now a section inside the demo readout.
  const mapBox = await page.locator('#viewport').boundingBox();
  await page.mouse.move(mapBox.x + mapBox.width * .7, mapBox.y + mapBox.height * .55);
  await page.waitForFunction(() => document.querySelector('#demo-signal-values')?.innerText.includes('场景设备'), null, {timeout: 10000});
  assert.ok((await page.locator('#demo-signal-values').innerText()).includes('信号估计'));
  assert.equal(await page.locator('#signal-probe').count(), 0, 'standalone signal probe is removed');
  await page.screenshot({path: `${outDir}/09b-demo-details.png`});
  await page.locator('#equipment-demo-hud [data-demo-action="back"]').click();
  await page.waitForFunction(() => !document.querySelector('#ac8-equipment-menu')?.classList.contains('is-demo-details'), null, {timeout: 4000});
  await page.waitForFunction(() => {
    const content = document.querySelector('#ac8-equipment-menu .ac8-hud-content');
    return content && Number(getComputedStyle(content).opacity) > .9;
  }, null, {timeout: 20000});
  assert.equal(await page.locator('#equipment-demo-hud').isVisible(), false, '返回反无设备 hides the demo readout');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8EquipmentMenu?.isDetail(), null, {timeout: 3000});
  await page.waitForFunction(() => {
    const el = document.querySelector('#ac8-equipment-menu .ac8-hud-content');
    return el && (getComputedStyle(el).visibility === 'hidden' || Number(getComputedStyle(el).opacity) < .05);
  }, null, {timeout: 4000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8EquipmentMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#equipment-window').isVisible(), false);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.ac8-scene-info')).opacity) > .5, null, {timeout: 4000});

  // 推演部署: same HUD form and the balanced plan is the default.
  await page.locator('#toggle-deployment').click();
  await page.waitForFunction(() => window.__ac8DeploymentMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('#deployment-window').isVisible(), false, 'legacy deployment window is retired');
  assert.equal(await page.locator('#ac8-deployment-menu .ac8-hud-tabs button').count(), 5);
  await page.screenshot({path: `${outDir}/10-deployment-options.png`});
  await page.locator('#ac8-deployment-menu .ac8-hud-tabs button', {hasText: '飞行演示'}).click();
  await page.waitForFunction(() => window.__ac8DeploymentMenu?.isDetail(), null, {timeout: 3000});
  await page.locator('#task3-panel .task3-subnav-btn', {hasText: '单机飞行警报'}).click();
  await page.waitForFunction(() => window.planningDiagnostics?.ready, null, {timeout: 120000});
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#planning-panel').isVisible(), true);
  assert.equal(await page.locator('#planning-plan').inputValue(), 'balanced', 'balanced plan is the default');
  await page.screenshot({path: `${outDir}/11-deployment-planning.png`});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8DeploymentMenu?.isDetail(), null, {timeout: 3000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8DeploymentMenu?.isOpen(), null, {timeout: 3000});
  await page.waitForTimeout(900);

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log('scene menu smoke: OK');
} finally {
  await page?.close();
  await browser.close();
}
