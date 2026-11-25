// Shared helpers for the AC8 scene-settings HUD menu used by browser smokes.
export async function openSceneMenu(page, pageId = 'scene', {timeout = 5000} = {}) {
  if (!(await page.evaluate(() => window.__ac8SceneMenu?.isOpen()))) {
    await page.locator('#open-city-model').click();
    await page.waitForFunction(() => window.__ac8SceneMenu?.isOpen(), null, {timeout});
    await page.waitForTimeout(800);
  }
  if (pageId) {
    if (await page.evaluate(() => window.__ac8SceneMenu?.isDetail())) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__ac8SceneMenu?.isDetail(), null, {timeout});
      await page.waitForTimeout(350);
    }
    await page.locator(`.ac8-scene-tabs button[data-page="${pageId}"]`).click();
    await page.waitForFunction(() => window.__ac8SceneMenu?.isDetail(), null, {timeout});
    await page.waitForTimeout(700);
  }
}

export async function backSceneMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isDetail(), null, {timeout: 5000});
  await page.waitForTimeout(350);
}

export async function closeSceneMenu(page) {
  for (let i = 0; i < 3 && await page.evaluate(() => window.__ac8SceneMenu?.isOpen()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
  }
  await page.waitForFunction(() => !window.__ac8SceneMenu?.isOpen(), null, {timeout: 5000});
  await page.waitForTimeout(500);
}
