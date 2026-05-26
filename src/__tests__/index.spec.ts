import { describe, expect, test } from 'vitest';
import * as auklet from '#auklet/index';

describe('auklet public api', () => {
  test('exports runtime APIs from the root entry', () => {
    expect(auklet.aukletStylePlugin).toEqual(expect.any(Function));
    expect(auklet.runAukletCli).toEqual(expect.any(Function));
    expect(auklet.loadAukletConfig).toEqual(expect.any(Function));
    expect(auklet.runTsdown).toEqual(expect.any(Function));
    expect(auklet.defineKernelPackageConfigFromFile).toEqual(
      expect.any(Function),
    );
    expect(auklet.defineKernelPackageConfigFromOptions).toEqual(
      expect.any(Function),
    );
  });

  test('does not expose internal implementation APIs from the root entry', () => {
    expect('ModuleStyleBuilder' in auklet).toBe(false);
    expect('ModuleStyleWatcher' in auklet).toBe(false);
    expect('PublishRunner' in auklet).toBe(false);
    expect('OwnerRunner' in auklet).toBe(false);
    expect('createTsdownArgs' in auklet).toBe(false);
    expect('resolveAukletConfigModule' in auklet).toBe(false);
    expect('normalizeAukletConfig' in auklet).toBe(false);
    expect('aukletDefaultOptions' in auklet).toBe(false);
  });
});
