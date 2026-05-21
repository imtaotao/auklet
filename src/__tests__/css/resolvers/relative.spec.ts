import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveRelativeSourceImport } from '#auklet/css/core/resolvers/relative';

describe('resolveRelativeSourceImport', () => {
  test('resolves relative source imports from the importer directory', () => {
    expect(
      resolveRelativeSourceImport(
        path.join('components', 'Mdx'),
        '../EnglishCards',
      ),
    ).toEqual([path.join('components', 'EnglishCards')]);
  });

  test('ignores non-relative imports', () => {
    expect(
      resolveRelativeSourceImport('components/Mdx', '#widgets/EnglishCards'),
    ).toEqual([]);
  });
});
