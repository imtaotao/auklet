import { describe, expect, test } from 'vitest';
import * as auklet from '#auklet/index';

describe('auklet public api', () => {
  test('exports runtime APIs from the root entry', () => {
    expect(auklet.aukletDefaultOptions).toEqual({
      source: 'src',
      output: 'dist',
      modules: false,
      build: {
        formats: ['cjs', 'esm', 'iife'],
        target: 'es2020',
        platform: 'neutral',
      },
      styles: {
        themes: {},
        dependencies: {},
      },
    });
    expect(auklet.aukletDefaultStyleDependencyConfig.entry).toBe('/style.css');
    expect(auklet.normalizeAukletConfig).toEqual(expect.any(Function));
    expect(auklet.aukletStylePlugin).toEqual(expect.any(Function));
    expect(auklet.ModuleStyleBuilder).toEqual(expect.any(Function));
    expect(auklet.ModuleStyleWatcher).toEqual(expect.any(Function));
    expect(auklet.createTsdownArgs).toEqual(expect.any(Function));
    expect(auklet.runTsdown).toEqual(expect.any(Function));
    expect(auklet.loadAukletConfig).toEqual(expect.any(Function));
    expect(auklet.resolveAukletConfigModule).toEqual(expect.any(Function));
  });

  test('does not expose tsdown config file helpers from the root entry', () => {
    expect('defineKernelPackageConfigFromFile' in auklet).toBe(false);
    expect('defineKernelPackageConfigFromOptions' in auklet).toBe(false);
  });
});
