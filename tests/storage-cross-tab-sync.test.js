import { test, expect, devices } from '@playwright/test';

const mobileDevice = devices['iPhone 13'];

test.use({
  ...mobileDevice,
  browserName: 'chromium'
});

test('propagates scene and automation storage updates across tabs', async ({ page, context }) => {
  test.setTimeout(120000);

  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.selectMode === 'function');
  await page.evaluate(() => {
    window.selectMode('reactive');
  });

  await page.waitForFunction(
    () => window.choreographer && typeof window.choreographer.getStorageBridge === 'function',
    null,
    { timeout: 45000 }
  );

  await page.evaluate(() => {
    const bridge = window.choreographer?.getStorageBridge?.();
    bridge?.tryRestorePersistence?.({ copyMemory: true });
  });

  await page.waitForFunction(
    () => window.choreographer?.sceneState?.storageMode === 'localStorage',
    null,
    { timeout: 45000 }
  );

  const controls = page.locator('#controls');
  const collapseButton = page.locator('#controls-collapse-btn');
  if (await controls.evaluate((element) => element.classList.contains('is-collapsed'))) {
    await collapseButton.click();
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  }

  const sceneLabSection = page.locator('details[data-section-key="scene-lab"]');
  if (!(await sceneLabSection.evaluate((element) => element.open))) {
    await sceneLabSection.locator('summary').click();
    await expect(sceneLabSection).toHaveJSProperty('open', true);
  }

  const captureButton = page.locator('#capture-scene-btn');
  await captureButton.click();

  const sceneCards = page.locator('.scene-card');
  await expect(sceneCards).toHaveCount(1);

  const saveButton = page.locator('#save-scene-set-btn');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await page.waitForFunction(
    () => Boolean(window.localStorage.getItem('vib34dSceneSetV1')),
    null,
    { timeout: 45000 }
  );

  const remoteName = 'Remote Sync Scene';
  const auxiliaryPage = await context.newPage();
  await auxiliaryPage.goto('/index.html');
  await auxiliaryPage.waitForFunction(
    () => Boolean(window.localStorage.getItem('vib34dSceneSetV1')),
    null,
    { timeout: 45000 }
  );

  await auxiliaryPage.evaluate((name) => {
    const payload = window.localStorage.getItem('vib34dSceneSetV1');
    if (!payload) return;
    const parsed = JSON.parse(payload);
    if (!parsed?.scenes?.length) return;
    parsed.scenes[0].name = name;
    window.localStorage.setItem('vib34dSceneSetV1', JSON.stringify(parsed));
  }, remoteName);

  await auxiliaryPage.close();

  const sceneTitle = sceneCards.first().locator('.scene-card__title');
  await expect(sceneTitle).toHaveText(remoteName);

  const clearingPage = await context.newPage();
  await clearingPage.goto('/index.html');
  await clearingPage.waitForFunction(
    () => Boolean(window.localStorage.getItem('vib34dSceneSetV1')),
    null,
    { timeout: 45000 }
  );

  await clearingPage.evaluate(() => {
    window.localStorage.removeItem('vib34dSceneSetV1');
  });

  await clearingPage.close();

  await page.waitForFunction(
    () => (window.choreographer?.sceneState?.scenes || []).length === 0,
    null,
    { timeout: 45000 }
  );

  const emptyState = page.locator('.scene-lab__empty');
  await expect(emptyState).toHaveText(/Capture the current modulation blend/i);
});
