import { describe, expect, test } from 'vitest';
import { normalizeFileKey, toFsSpecifier } from '#auklet/utils';

describe('css path helpers', () => {
  test('normalizes Windows style paths to stable slash keys', () => {
    expect(
      normalizeFileKey(
        'C:\\repo\\workspace\\packages\\app-package\\src\\index.css',
      ),
    ).toBe('C:/repo/workspace/packages/app-package/src/index.css');
  });

  test('creates Vite fs specifiers with slash paths', () => {
    expect(
      toFsSpecifier(
        'C:\\repo\\workspace\\packages\\app-package\\src\\index.css',
      ),
    ).toBe('/@fs/C:/repo/workspace/packages/app-package/src/index.css');
  });
});
