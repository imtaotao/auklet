import { describe, expect, test } from 'vitest';
import { lines, listDistFiles, readDist } from './helpers';

const singlePackage = 'examples/single-package';

describe('single package example', () => {
  test('keeps module style dependency chains', () => {
    expect(readDist(singlePackage, 'es/style/index.css')).toBe(
      lines('@import "./module.css";'),
    );
    expect(readDist(singlePackage, 'es/components/Panel/style/index.css')).toBe(
      lines(
        '@import "../../Button/style/index.css";',
        '@import "../index.css";',
      ),
    );
  });

  test('bundles local CSS content', () => {
    const css = readDist(singlePackage, 'index.css');

    expect(css).toContain('.single-button');
    expect(css).toContain('.single-panel');
  });

  test('emits bundle, module, and style files', () => {
    expect(listDistFiles(singlePackage)).toEqual([
      'es/components/Button/index.css',
      'es/components/Button/index.d.ts',
      'es/components/Button/index.js',
      'es/components/Button/style/index.css',
      'es/components/Panel/index.css',
      'es/components/Panel/index.d.ts',
      'es/components/Panel/index.js',
      'es/components/Panel/style/index.css',
      'es/index.css',
      'es/index.d.ts',
      'es/index.js',
      'es/style/external.css',
      'es/style/index.css',
      'es/style/module.css',
      'index.cjs',
      'index.css',
      'index.d.cts',
      'index.global.js',
      'index.js',
      'index.mjs',
      'lib/components/Button/index.css',
      'lib/components/Button/index.d.ts',
      'lib/components/Button/index.js',
      'lib/components/Button/style/index.css',
      'lib/components/Panel/index.css',
      'lib/components/Panel/index.d.ts',
      'lib/components/Panel/index.js',
      'lib/components/Panel/style/index.css',
      'lib/index.css',
      'lib/index.d.ts',
      'lib/index.js',
      'lib/style/external.css',
      'lib/style/index.css',
      'lib/style/module.css',
    ]);
  });
});
