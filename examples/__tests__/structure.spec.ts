import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const math = 'examples/libs/packages/math';
const string = 'examples/libs/packages/string';
const dashboard = 'examples/components/packages/dashboard';
const bundleFiles = ['index.cjs', 'index.d.ts', 'index.js', 'index.mjs'];

const listDistFiles = (packageDir: string) => {
  const files: Array<string> = [];
  const distRoot = path.join(process.cwd(), packageDir, 'dist');

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      files.push(path.relative(distRoot, file).split(path.sep).join('/'));
    }
  };
  walk(distRoot);
  return files.sort();
};

describe('examples build output structure', () => {
  test('pure lib packages emit bundle files only', () => {
    expect(listDistFiles(math)).toEqual(bundleFiles);
    expect(listDistFiles(string)).toEqual(bundleFiles);
  });

  test('component packages emit bundle, module, and style files', () => {
    expect(listDistFiles(dashboard)).toEqual([
      'es/components/Dashboard/index.css',
      'es/components/Dashboard/index.d.ts',
      'es/components/Dashboard/index.js',
      'es/components/Dashboard/style/index.css',
      'es/index.d.ts',
      'es/index.js',
      'es/style/external.css',
      'es/style/index.css',
      'es/style/module.css',
      'es/themes/dark.css',
      'es/themes/light.css',
      'index.cjs',
      'index.css',
      'index.d.ts',
      'index.js',
      'index.mjs',
      'lib/components/Dashboard/index.css',
      'lib/components/Dashboard/index.d.ts',
      'lib/components/Dashboard/index.js',
      'lib/components/Dashboard/style/index.css',
      'lib/index.d.ts',
      'lib/index.js',
      'lib/style/external.css',
      'lib/style/index.css',
      'lib/style/module.css',
      'lib/themes/dark.css',
      'lib/themes/light.css',
    ]);
  });
});
