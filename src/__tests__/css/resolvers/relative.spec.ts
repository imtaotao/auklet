import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveRelativeSourceImport } from '#auklet/css/core/resolvers/relative';

describe('resolveRelativeSourceImport', () => {
  const resolve = (importer: string, importPath: string) => {
    return resolveRelativeSourceImport(importer, importPath);
  };

  test('resolves relative source imports from the importer directory', () => {
    const importer = path.join('components', 'Mdx');

    expect(resolve(importer, '../EnglishCards')).toEqual([
      path.join('components', 'EnglishCards'),
    ]);
  });

  test('ignores non-relative imports', () => {
    expect(resolve('components/Mdx', '#widgets/EnglishCards')).toEqual([]);
  });
});
