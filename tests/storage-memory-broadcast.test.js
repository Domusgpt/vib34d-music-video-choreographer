import { test, expect, devices } from '@playwright/test';

const mobileDevice = devices['iPhone 13'];

test.use({
  ...mobileDevice,
  browserName: 'chromium'
});

test('synchronises session scenes across tabs via broadcast channel', async ({ context, page }) => {
  test.setTimeout(120000);

  await context.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (String(key).includes('__probe__')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.selectMode === 'function');
  await page.evaluate(() => {
    window.selectMode('reactive');
  });

  await page.waitForFunction(
    () => window.choreographer?.sceneState?.storageMode === 'memory',
    null,
    { timeout: 45000 }
  );

  await page.evaluate(() => {
    const scene = window.choreographer.captureCurrentScene();
    if (!scene) {
      throw new Error('Failed to capture scene for broadcast test');
    }
    scene.name = 'Memory Broadcast Scene';
    window.choreographer.renderSceneList();
    window.choreographer.updateSceneUiState();
    window.choreographer.persistSceneStateToStorage({ announce: false });
  });

  await page.waitForFunction(
    () => (window.choreographer?.sceneState?.scenes || []).length === 1,
    null,
    { timeout: 45000 }
  );

  const secondaryPage = await context.newPage();
  await secondaryPage.goto('/index.html');
  await secondaryPage.waitForFunction(() => typeof window.selectMode === 'function');
  await secondaryPage.evaluate(() => {
    window.selectMode('reactive');
  });

  await secondaryPage.waitForFunction(
    () => window.choreographer?.sceneState?.storageMode === 'memory',
    null,
    { timeout: 45000 }
  );

  const remoteSceneCards = secondaryPage.locator('.scene-card');
  await expect(remoteSceneCards).toHaveCount(1, { timeout: 45000 });
  const remoteTitle = secondaryPage.locator('.scene-card__title').first();
  await expect(remoteTitle).toHaveText('Memory Broadcast Scene');

  await secondaryPage.evaluate(() => {
    const scenes = window.choreographer?.sceneState?.scenes;
    if (!Array.isArray(scenes) || !scenes.length) {
      throw new Error('No scenes available for rename broadcast');
    }
    scenes[0].name = 'Remote Memory Update';
    window.choreographer.renderSceneList();
    window.choreographer.updateSceneUiState();
    window.choreographer.persistSceneStateToStorage({ announce: false });
  });

  await page.waitForFunction(
    (expected) => {
      const scenes = window.choreographer?.sceneState?.scenes;
      if (!Array.isArray(scenes) || !scenes.length) {
        return false;
      }
      return scenes[0].name === expected;
    },
    'Remote Memory Update',
    { timeout: 45000 }
  );

  const primaryTitle = page.locator('.scene-card__title').first();
  await expect(primaryTitle).toHaveText('Remote Memory Update');

  await secondaryPage.close();
});
