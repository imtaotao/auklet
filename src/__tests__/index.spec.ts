import { describe, expect, test } from 'vitest';
import * as auklet from '#auklet/index';

describe('auklet public api', () => {
  test('exports runtime APIs from the root entry', () => {
    expect(auklet.aukletDefaultCssOptions).toEqual({
      sourceDir: 'src',
      outputDir: 'dist',
      themes: {},
    });
    expect(auklet.aukletDefaultCssDependencyConfig.global).toBe('/style.css');
    expect(auklet.aukletCssPlugin).toEqual(expect.any(Function));
    expect(auklet.ModuleCssBuilder).toEqual(expect.any(Function));
    expect(auklet.ModuleCssWatcher).toEqual(expect.any(Function));
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
