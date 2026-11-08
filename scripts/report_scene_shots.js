import {chromium} from 'playwright-core';
import {mkdir, writeFile} from 'node:fs/promises';

const outDir = 'artifacts/report_work/shots';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({viewport: {width: 1600, height: 900}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error' && !/favicon/i.test(message.text())) errors.push(`console: ${message.text()}`); });

const shot = name => page.screenshot({path: `${outDir}/${name}.png`});
const menuOpen = () => page.evaluate(() => !!window.__ac8SceneMenu?.isOpen());
const menuDetail = () => page.evaluate(() => !!window.__ac8SceneMenu?.isDetail());

async function openMenu() {
  if (await menuOpen()) return;
  await page.locator('#open-city-model').click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen(), null, {timeout: 10000});
  await page.waitForTimeout(1400);
}
async function openPage(id) {
  await openMenu();
  if (await menuDetail()) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__ac8SceneMenu?.isDetail(), null, {timeout: 5000});
    await page.waitForTimeout(500);
  }
  await page.locator(`.ac8-scene-tabs button[data-page="${id}"]`).click();
  await page.waitForFunction(() => window.__ac8SceneMenu?.isDetail(), null, {timeout: 5000});
  await page.waitForTimeout(1000);
}
async function closeMenu() {
  for (let i = 0; i < 3 && await menuOpen(); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(380);
  }
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(1500);
}
async function collect(label) {
  return page.evaluate(label => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() ?? '';
    const diag = window.cityDiagnostics ?? {};
    return {
      label,
      area: text('[data-info="area"]'),
      coordinates: text('[data-info="coordinates"]'),
      equipment: text('[data-info="equipment"]'),
      plan: text('[data-info="plan"]'),
      count: text('#count'),
      height: text('#height'),
      coreLabel: text('#core-label') || text('#museum-label'),
      modelMode: diag.modelMode,
      features: diag.features,
      buildingTriangles: diag.buildingTriangles,
      terrainVertices: diag.terrainVertices,
      models: diag.models,
    };
  }, label);
}

try {
  await mkdir(outDir, {recursive: true});
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}?intro=0`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, {timeout: 120000});
  await page.waitForTimeout(2000);

  await shot('01_main_menu');

  await openMenu();
  await shot('02_scene_options');

  await openPage('scene');
  await shot('03_scene_select');

  await openPage('environment');
  await shot('04_environment');

  await openPage('target');
  await shot('05_target_basic');
  await page.locator('#city-target-page .city-settings-nav').getByRole('button', {name: '位置', exact: true}).click();
  await page.waitForTimeout(900);
  await shot('06_target_position');

  await openPage('scene');
  await page.locator('#buildings').uncheck();
  await page.waitForTimeout(900);
  await shot('07_layers_off');
  await page.locator('#buildings').check();
  await page.waitForTimeout(500);

  await page.locator('#top').click();
  await page.waitForTimeout(1200);
  await closeMenu();
  await shot('08_view_top');

  await openPage('scene');
  await page.locator('#museum-focus').click();
  await page.waitForTimeout(1200);
  await closeMenu();
  await shot('09_view_core');

  await openPage('scene');
  await page.locator('#reset').click();
  await page.waitForTimeout(1200);
  await closeMenu();
  await shot('10_recon_full');
  const scenes = [await collect('河南博物院')];

  const sites = [
    ['beijing', '北京故宫', '11_beijing'],
    ['shenzhen', '深圳国际交流中心', '12_shenzhen'],
    ['daxing', '大兴机场', '13_daxing'],
    ['hangzhou', '杭州萧山机场', '14_hangzhou'],
    ['nuclear', '房山核设施', '15_nuclear'],
    ['changjiang', '海南昌江核电厂', '16_changjiang'],
    ['railway', '北京—通州铁路', '17_railway'],
  ];
  for (const [id, label, name] of sites) {
    await openPage('scene');
    await page.selectOption('#model-select', id);
    await page.waitForFunction(modelId => window.cityDiagnostics?.modelMode === modelId && window.cityDiagnostics.models?.[modelId]?.loaded === true, id, {timeout: 600000});
    await page.waitForTimeout(2200);
    await closeMenu();
    await shot(name);
    await page.waitForTimeout(1400);
    scenes.push(await collect(label));
    console.log('captured', id, label);
  }

  await writeFile('artifacts/report_work/scene_data.json', JSON.stringify({scenes, errors}, null, 2), 'utf8');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('scene screenshots: OK');
} finally {
  await page.close();
  await browser.close();
}
