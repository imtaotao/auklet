import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  collectDirectPackageStyleHotUpdateModules,
  fromPackageStyleVirtualId,
  PACKAGE_STYLE_VIRTUAL_PREFIX,
  toPackageStyleVirtualId,
} from '#auklet/css/vite/packageStyleVirtualId';

describe('packageStyleVirtualId', () => {
  test('round-trips absolute file paths', () => {
    const file = path.resolve('/tmp/demo/helpers.css');
    const id = toPackageStyleVirtualId(file);
    expect(id.startsWith(PACKAGE_STYLE_VIRTUAL_PREFIX)).toBe(true);
    expect(fromPackageStyleVirtualId(id)).toBe(file);
  });

  test('collectDirectPackageStyleHotUpdateModules finds the virtual module', () => {
    const file = path.resolve('/tmp/demo/helpers.css');
    const virtualId = toPackageStyleVirtualId(file);
    const moduleNode = { id: virtualId };
    const modules = collectDirectPackageStyleHotUpdateModules({
      file,
      moduleGraph: {
        getModuleById: (id) =>
          id === virtualId ? (moduleNode as never) : undefined,
      },
    });
    expect(modules).toEqual([moduleNode]);
  });

  test('collectDirectPackageStyleHotUpdateModules is empty when not loaded', () => {
    const file = path.resolve('/tmp/demo/helpers.css');
    const modules = collectDirectPackageStyleHotUpdateModules({
      file,
      moduleGraph: {
        getModuleById: () => undefined,
      },
    });
    expect(modules).toEqual([]);
  });
});
