import { test, expect, devices } from '@playwright/test';

const mobileDevice = devices['iPhone 13'];

test.use({
  ...mobileDevice,
  browserName: 'chromium'
});

test('recovers persistent storage after fallback and preserves data on reload', async ({ page }) => {
  test.setTimeout(120000);

  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Object.defineProperty(window, '__originalSetItem', {
      value: originalSetItem,
      configurable: true
    });

    const storedDefault = sessionStorage.getItem('__allowPersistentDefault');
    window.__allowPersistent = storedDefault ? storedDefault === 'true' : false;
    window.__setPersistentDefault = (value) => {
      const flag = Boolean(value);
      window.__allowPersistent = flag;
      sessionStorage.setItem('__allowPersistentDefault', flag ? 'true' : 'false');
    };

    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (!window.__allowPersistent && !String(key).includes('__probe__')) {
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
    () => {
      const instance = window.choreographer;
      return instance && typeof instance.getStorageBridge === 'function';
    },
    null,
    { timeout: 45000 }
  );

  const initialMode = await page.evaluate(() => {
    const bridge = window.choreographer?.getStorageBridge?.();
    return bridge?.getMode?.();
  });

  if (initialMode !== 'memory') {
    await page.evaluate(() => {
      const bridge = window.choreographer?.getStorageBridge?.();
      bridge?.set('recovery-test-downgrade', String(Date.now()));
    });

    await page.waitForFunction(
      () => window.choreographer?.getStorageBridge?.()?.getMode?.() === 'memory',
      null,
      { timeout: 45000 }
    );
  }

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

  await page.locator('#control-panel-body').evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });

  const captureButton = page.locator('#capture-scene-btn');
  await captureButton.click();

  const sceneCards = page.locator('.scene-card');
  await expect(sceneCards).toHaveCount(1);

  const saveButton = page.locator('#save-scene-set-btn');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  const storageStatus = page.locator('#scene-storage-status');
  await expect(storageStatus).toHaveAttribute('data-mode', 'session');

  await page.evaluate(() => {
    window.__setPersistentDefault(true);
    window.dispatchEvent(new Event('focus'));
  });

  await page.waitForFunction(
    () => window.choreographer?.getStorageBridge?.()?.getMode?.() === 'localStorage',
    null,
    { timeout: 45000 }
  );

  await page.waitForFunction(
    () => window.choreographer?.sceneState?.storageMode === 'localStorage',
    null,
    { timeout: 45000 }
  );

  const storageIndicator = page.locator('#control-panel-storage-indicator');
  await expect(storageIndicator).toHaveAttribute('data-mode', 'persistent');
  await expect(storageStatus).toHaveAttribute('data-mode', 'persistent');

  await page.waitForFunction(
    () => window.localStorage.getItem('vib34dSceneSetV1'),
    null,
    { timeout: 45000 }
  );

  const persistedPayload = await page.evaluate(() => window.localStorage.getItem('vib34dSceneSetV1'));
  expect(persistedPayload).toBeTruthy();

  await page.reload();
  await page.waitForFunction(() => typeof window.selectMode === 'function');
  await page.evaluate(() => {
    window.selectMode('reactive');
  });

  await page.waitForFunction(
    () => window.choreographer?.getStorageBridge?.()?.getMode?.() === 'localStorage',
    null,
    { timeout: 45000 }
  );

  await page.waitForFunction(
    () => window.choreographer?.sceneState?.storageMode === 'localStorage',
    null,
    { timeout: 45000 }
  );

  if (!(await sceneLabSection.evaluate((element) => element.open))) {
    await sceneLabSection.locator('summary').click();
    await expect(sceneLabSection).toHaveJSProperty('open', true);
  }

  await expect(sceneCards).toHaveCount(1);
  await expect(storageIndicator).toHaveAttribute('data-mode', 'persistent');
});
