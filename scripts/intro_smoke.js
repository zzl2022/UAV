import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const executablePath = process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5183';
const introUrl = `${appUrl}${appUrl.includes('?') ? '&' : '?'}intro=1`;
const outDir = 'artifacts/intro';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

const allErrors = [];

async function openIntro() {
  const page = await browser.newPage({viewport: {width: 1600, height: 900}});
  page.on('pageerror', error => allErrors.push(`pageerror: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon/i.test(msg.text())) allErrors.push(`console: ${msg.text()}`); });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon/i.test(response.url())) allErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(introUrl, {waitUntil: 'commit'});
  await page.waitForFunction(() => window.__ac8Intro && document.getElementById('ac8-intro'), null, {timeout: 30000, polling: 10});
  return page;
}

async function shotAt(name, waitFor) {
  const page = await openIntro();
  await page.waitForFunction(waitFor, null, {timeout: 30000, polling: 10});
  const state = await page.evaluate(() => window.__ac8Intro.state);
  await page.screenshot({path: `${outDir}/${name}.png`});
  await page.close();
  return state;
}

try {
  await mkdir(outDir, {recursive: true});

  const states = [];
  states.push(await shotAt('01-crosshair', () => window.__ac8Intro.state.started && window.__ac8Intro.state.t >= 0.28));
  states.push(await shotAt('02-axis', () => window.__ac8Intro.state.started && window.__ac8Intro.state.t >= 0.9));
  states.push(await shotAt('03-frame', () => window.__ac8Intro.state.started && window.__ac8Intro.state.t >= 1.35));
  states.push(await shotAt('04-grid', () => window.__ac8Intro.state.started && window.__ac8Intro.state.t >= 1.85));
  states.push(await shotAt('05-depth', () => window.__ac8Intro.state.started && window.__ac8Intro.state.t >= 2.45));
  states.push(await shotAt('06-scan', () => window.__ac8Intro.state.scanStart === true));

  // Final state + interaction unlock.
  const page = await openIntro();
  await page.waitForFunction(() => window.__ac8Intro.done === true, null, {timeout: 120000, polling: 50});
  await page.waitForTimeout(950);
  await page.screenshot({path: `${outDir}/07-final.png`});
  const hudDebugInitial = await page.evaluate(() => window.__ac8Hud?.debug);
  assert.equal(await page.locator('#ac8-intro').count(), 0, 'intro removed');
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('intro-active')), false, 'intro-active removed');
  const pointerEvents = await page.locator('#app').evaluate(el => getComputedStyle(el).pointerEvents);
  assert.notEqual(pointerEvents, 'none', 'app is interactive');
  assert.equal(await page.locator('canvas.ac8-hud-canvas').count(), 0, 'HUD overlay canvas removed after intro');
  assert.equal(await page.evaluate(() => window.__ac8Hud?.finishedState), true, '3D HUD finished in persistent state');
  assert.equal(await page.evaluate(() => window.__ac8Hud?.inWorld), true, '3D HUD merged into the main scene');

  // Orbit the camera; the HUD is in model space and must rotate with it.
  const viewportBox = await page.locator('#viewport').boundingBox();
  await page.mouse.move(viewportBox.x + viewportBox.width * 0.55, viewportBox.y + viewportBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(viewportBox.x + viewportBox.width * 0.75, viewportBox.y + viewportBox.height * 0.6, {steps: 24});
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({path: `${outDir}/08-orbit.png`});
  const hudDebug = await page.evaluate(() => window.__ac8Hud?.debug);

  // Skip path.
  const skipPage = await openIntro();
  await skipPage.waitForTimeout(350);
  await skipPage.keyboard.press('Escape');
  await skipPage.waitForFunction(() => window.__ac8Intro.done === true, null, {timeout: 10000, polling: 20});
  assert.equal(await skipPage.locator('body').evaluate(el => el.classList.contains('intro-active')), false, 'skip removes lock');
  await skipPage.close();
  await page.close();

  console.log('hud initial:', JSON.stringify(hudDebugInitial));
  console.log('hud orbit:', JSON.stringify(hudDebug));
  console.log('phases:', states.map(s => `${s.status}@${s.t.toFixed(2)}s`).join(' | '));
  if (allErrors.length) throw new Error('Browser errors:\n' + allErrors.join('\n'));
  console.log('intro smoke: OK');
} finally {
  await browser.close();
}
