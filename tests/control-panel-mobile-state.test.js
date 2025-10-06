import { test, expect, devices } from '@playwright/test';

const mobileDevice = devices['iPhone 13'];

test.use({
  ...mobileDevice,
  browserName: 'chromium'
});

test('control surface remembers mobile collapse and section state', async ({ page }) => {
  test.setTimeout(120000);

  const attachLogging = (targetPage, label = 'PAGE') => {
    targetPage.on('console', (message) => {
      console.log(`${label} ${message.type().toUpperCase()}:`, message.text());
    });

    targetPage.on('pageerror', (error) => {
      console.log(`${label} ERROR:`, error);
    });
  };

  attachLogging(page);

  await page.goto('/index.html');

  await page.evaluate(() => {
    localStorage.clear();
  });

  await page.waitForFunction(() => typeof window.selectMode === 'function');
  await page.evaluate(() => {
    window.selectMode('reactive');
  });

  await page.waitForFunction(
    () => Boolean(window.choreographer?.boundBeforeUnloadHandler),
    null,
    { timeout: 45000 }
  );
  await page.evaluate(() => {
    const handler = window.choreographer?.boundBeforeUnloadHandler;
    if (handler) {
      window.removeEventListener('beforeunload', handler);
      window.choreographer.boundBeforeUnloadHandler = null;
    }
  });

  await page.waitForFunction(
    () => {
      const controls = document.getElementById('controls');
      return (
        controls &&
        controls.classList.contains('active') &&
        controls.classList.contains('controls--mobile')
      );
    },
    null,
    { timeout: 45000 }
  );

  const controls = page.locator('#controls');
  await expect(controls).toBeVisible();
  await expect(controls).toHaveClass(/controls--mobile/);
  await expect(controls).toHaveClass(/is-collapsed/);

  const collapseButton = page.locator('#controls-collapse-btn');
  await collapseButton.click();

  await expect(controls).toHaveClass(/controls--mobile/);
  await expect(controls).not.toHaveClass(/is-collapsed/);
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');

  const timelineDetails = page.locator('details[data-section-key="timeline"]');
  const timelineSummary = timelineDetails.locator('summary');
  await timelineSummary.click();
  await expect(timelineDetails).toHaveJSProperty('open', true);

  await page.waitForTimeout(750);

  const handleDialog = (dialog) => {
    if (dialog.type() === 'beforeunload') {
      dialog.accept().catch(() => {});
    }
  };
  page.on('dialog', handleDialog);

  await page.reload({ waitUntil: 'domcontentloaded' });
  page.off('dialog', handleDialog);

  await page.waitForFunction(() => typeof window.selectMode === 'function');
  await page.evaluate(() => {
    window.selectMode('reactive');
  });

  await page.waitForFunction(
    () => {
      const controlsElement = document.getElementById('controls');
      const timeline = document.querySelector('details[data-section-key="timeline"]');

      if (!controlsElement || !timeline) {
        return false;
      }

      const hasMobile = controlsElement.classList.contains('controls--mobile');
      const isActive = controlsElement.classList.contains('active');
      const expanded = !controlsElement.classList.contains('is-collapsed');
      const timelineOpen = timeline.open === true;

      return hasMobile && isActive && expanded && timelineOpen;
    },
    null,
    { timeout: 45000 }
  );

  const controlsAfterReload = page.locator('#controls');
  const collapseButtonAfterReload = page.locator('#controls-collapse-btn');
  const timelineDetailsAfterReload = page.locator('details[data-section-key="timeline"]');

  await expect(controlsAfterReload).toBeVisible();
  await expect(controlsAfterReload).toHaveClass(/controls--mobile/);
  await expect(controlsAfterReload).not.toHaveClass(/is-collapsed/);

  const reloadState = await controlsAfterReload.evaluate((element) => ({
    hasMobile: element.classList.contains('controls--mobile'),
    isCollapsed: element.classList.contains('is-collapsed')
  }));
  expect(reloadState.hasMobile).toBe(true);
  expect(reloadState.isCollapsed).toBe(false);
  await expect(collapseButtonAfterReload).toHaveAttribute('aria-expanded', 'true');
  await expect(timelineDetailsAfterReload).toHaveJSProperty('open', true);
});
