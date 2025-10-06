import { test, expect } from '@playwright/test';

const PARAMS = ['rot4dXW', 'rot4dYW', 'rot4dZW'];

test('Reactivity controller responds to live vector inputs', async ({ page }) => {
  await page.goto('/test-engine.html');

  const report = await page.evaluate(async (params) => {
    const { ReactivityController } = await import('/src/core/ReactivityController.js');
    const controller = new ReactivityController({ beatDecay: 0.75 });

    controller.registerModulator('orbital', {
      type: 'lfo',
      frequency: 0.5,
      amplitude: 0.6,
      enabled: true
    });

    controller.registerParameter('rot4dXW', {
      range: [-1.6, 1.6],
      smoothing: 0.2,
      compute: (meta) => meta.liveVector.y + meta.controller.getModulatorValue('orbital') * 0.4
    });
    controller.registerParameter('rot4dYW', {
      range: [-1.6, 1.6],
      smoothing: 0.2,
      compute: (meta) => meta.liveVector.x * 0.8
    });
    controller.registerParameter('rot4dZW', {
      range: [-1.6, 1.6],
      smoothing: 0.2,
      compute: (meta) => (meta.liveVector.y * 0.5) + (meta.liveVector.x * 0.3)
    });

    const audio = {
      bass: 0,
      lowMid: 0,
      mid: 0,
      high: 0,
      energy: 0,
      brightness: 0,
      warmth: 0,
      spectralTilt: 0,
      transient: 0,
      dynamics: 0,
      momentum: 0
    };

    const context = { time: 0, deltaTime: 1 / 60 };

    controller.setLiveVector({ x: 0, y: 0 });
    controller.compute(audio, context);
    const initial = params.reduce((acc, name) => {
      acc[name] = controller.getLastValue(name);
      return acc;
    }, {});

    controller.setLiveVector({ x: 1, y: -1 });
    controller.updateModulators(0.25, audio, context);
    controller.compute(audio, context);
    const adjusted = params.reduce((acc, name) => {
      acc[name] = controller.getLastValue(name);
      return acc;
    }, {});

    controller.updateModulators(0.5, audio, context);
    controller.compute(audio, { time: 0.5, deltaTime: 0.5 });
    const later = params.reduce((acc, name) => {
      acc[name] = controller.getLastValue(name);
      return acc;
    }, {});

    return {
      initial,
      adjusted,
      later,
      liveVector: controller.getLiveVector(),
      modulators: controller.getModulatorSnapshot()
    };
  }, PARAMS);

  console.log('Reactivity Report:', report);

  PARAMS.forEach((name) => {
    expect(report.initial[name]).toBeDefined();
    expect(Math.abs(report.adjusted[name] - report.initial[name])).toBeGreaterThan(0.02);
    expect(Math.abs(report.adjusted[name])).toBeLessThanOrEqual(1.7);
    expect(Math.abs(report.later[name])).toBeLessThanOrEqual(1.7);
  });

  expect(report.liveVector.x).toBeCloseTo(1, 1);
  expect(report.liveVector.y).toBeCloseTo(-1, 1);
  Object.values(report.modulators).forEach((value) => {
    expect(typeof value).toBe('number');
  });
});
