import { test, expect, devices } from '@playwright/test';

const mobileDevice = devices['iPhone 13'];

test.use({
  ...mobileDevice,
  browserName: 'chromium'
});

test('falls back to session storage when localStorage is unavailable', async ({ page }) => {
  test.setTimeout(120000);

  await page.addInitScript(() => {
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

  const indicator = page.locator('#control-panel-storage-indicator');
  await expect(indicator).toHaveText(/Session only/i);
  await expect(indicator).toHaveAttribute('data-mode', 'session');

  const controls = page.locator('#controls');
  await expect(controls).toHaveClass(/controls--mobile/);
  await expect(controls).toHaveClass(/active/);

  const collapseButton = page.locator('#controls-collapse-btn');
  if (await controls.evaluate((element) => element.classList.contains('is-collapsed'))) {
    await collapseButton.click();
    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    await expect(controls).not.toHaveClass(/is-collapsed/);
  }

  const sceneLabSection = page.locator('details[data-section-key="scene-lab"]');
  if (!(await sceneLabSection.evaluate((element) => element.open))) {
    await sceneLabSection.locator('summary').click();
    await expect(sceneLabSection).toHaveJSProperty('open', true);
  }

  await page.locator('#control-panel-body').evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });

  const captureButton = page.locator('#capture-scene-btn');
  await captureButton.click();

  const sceneCards = page.locator('.scene-card');
  await expect(sceneCards).toHaveCount(1);

  const storageStatus = page.locator('#scene-storage-status');
  await expect(storageStatus).toHaveText(/Session storage/i);
  await expect(storageStatus).toHaveAttribute('data-mode', 'session');

  const automationInfo = page.locator('#automation-snapshot-info');
  await expect(automationInfo).toHaveAttribute('data-mode', 'session');
});
