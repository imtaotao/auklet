import { describe, expect, test } from 'vitest';
import { normalizeCssFileKey, toCssFsSpecifier } from '#auklet/css/core/path';

describe('css path helpers', () => {
  test('normalizes Windows style paths to stable slash keys', () => {
    expect(
      normalizeCssFileKey(
        'C:\\repo\\workspace\\packages\\app-package\\src\\index.css',
      ),
    ).toBe('C:/repo/workspace/packages/app-package/src/index.css');
  });

  test('creates Vite fs specifiers with slash paths', () => {
    expect(
      toCssFsSpecifier(
        'C:\\repo\\workspace\\packages\\app-package\\src\\index.css',
      ),
    ).toBe('/@fs/C:/repo/workspace/packages/app-package/src/index.css');
  });
});
