import { test, expect, devices } from '@playwright/test';

test.use({
  ...devices['iPhone 13'],
  browserName: 'chromium'
});

test('Visualizer lifecycle rebuilds canvases on mobile layout', async ({ page }) => {
  console.log('📱 Testing lifecycle manager on mobile viewport...');

  await page.goto('/test-engine.html');

  const summary = await page.evaluate(async () => {
    const container = document.createElement('div');
    container.id = 'visualizer-container';
    container.style.position = 'relative';
    container.style.width = '360px';
    container.style.height = '200px';
    document.body.appendChild(container);

    const layerIds = {
      faceted: 'vib34dLayers',
      quantum: 'quantumLayers',
      holographic: 'holographicLayers'
    };

    Object.values(layerIds).forEach((id) => {
      const group = document.createElement('div');
      group.id = id;
      group.style.position = 'absolute';
      group.style.inset = '0';
      container.appendChild(group);
    });

    const { VisualizerLifecycleManager } = await import('/src/core/VisualizerLifecycleManager.js');
    const lifecycle = new VisualizerLifecycleManager({
      root: container,
      containerMap: layerIds
    });

    const buildEngine = (label) => async () => ({
      label,
      active: false,
      setActive(state) { this.active = state; },
      destroyCalled: false,
      async destroy() { this.destroyCalled = true; }
    });

    const results = [];

    const facetedEngine = await lifecycle.switchSystem('faceted', buildEngine('faceted'));
    results.push({
      step: 'faceted',
      currentSystem: lifecycle.currentSystem,
      canvasCount: container.querySelectorAll('#vib34dLayers canvas').length,
      firstCanvas: container.querySelector('#vib34dLayers canvas')?.id ?? null,
      engineActive: facetedEngine.active === true
    });

    const quantumEngine = await lifecycle.switchSystem('quantum', buildEngine('quantum'));
    results.push({
      step: 'quantum',
      currentSystem: lifecycle.currentSystem,
      facetedCanvasCount: container.querySelectorAll('#vib34dLayers canvas').length,
      quantumCanvasCount: container.querySelectorAll('#quantumLayers canvas').length,
      previousDestroyCalled: facetedEngine.destroyCalled === true,
      engineActive: quantumEngine.active === true
    });

    const holographicEngine = await lifecycle.switchSystem('holographic', buildEngine('holographic'));
    results.push({
      step: 'holographic',
      currentSystem: lifecycle.currentSystem,
      quantumCanvasCount: container.querySelectorAll('#quantumLayers canvas').length,
      holographicCanvasCount: container.querySelectorAll('#holographicLayers canvas').length,
      previousDestroyCalled: quantumEngine.destroyCalled === true,
      engineActive: holographicEngine.active === true
    });

    lifecycle.ensureCanvasDimensions();

    return results;
  });

  console.log('Lifecycle Summary:', summary);

  expect(summary[0].step).toBe('faceted');
  expect(summary[0].currentSystem).toBe('faceted');
  expect(summary[0].canvasCount).toBeGreaterThan(0);
  expect(summary[0].engineActive).toBe(true);

  expect(summary[1].step).toBe('quantum');
  expect(summary[1].currentSystem).toBe('quantum');
  expect(summary[1].facetedCanvasCount).toBe(0);
  expect(summary[1].quantumCanvasCount).toBeGreaterThan(0);
  expect(summary[1].previousDestroyCalled).toBe(true);
  expect(summary[1].engineActive).toBe(true);

  expect(summary[2].step).toBe('holographic');
  expect(summary[2].currentSystem).toBe('holographic');
  expect(summary[2].quantumCanvasCount).toBe(0);
  expect(summary[2].holographicCanvasCount).toBeGreaterThan(0);
  expect(summary[2].previousDestroyCalled).toBe(true);
  expect(summary[2].engineActive).toBe(true);
});
