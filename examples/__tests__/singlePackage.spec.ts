import { describe, expect, test } from 'vitest';
import { lines, listDistFiles, readDist } from './helpers';

const singlePackage = 'examples/single-package';

describe('single package example', () => {
  test('keeps module style dependency chains', () => {
    expect(readDist(singlePackage, 'es/style/index.css')).toBe(
      lines('@import "./module.css";'),
    );
    expect(readDist(singlePackage, 'es/style/module.css')).toBe(
      lines(
        '@import "../components/Button/index.css";',
        '@import "../components/Chip/index.css";',
        '@import "../components/Panel/index.css";',
        '@import "../index.css";',
      ),
    );
    expect(readDist(singlePackage, 'es/components/Chip/style/index.css')).toBe(
      lines('@import "../index.css";'),
    );
    expect(readDist(singlePackage, 'es/components/Chip/index.css')).toContain(
      '@import "./tokens.css";',
    );
    expect(readDist(singlePackage, 'es/components/Chip/index.css')).toContain(
      '.single-chip',
    );
    expect(
      readDist(singlePackage, 'es/components/Chip/index.css'),
    ).not.toContain(':root');
    expect(readDist(singlePackage, 'es/components/Chip/tokens.css')).toBe(
      lines(':root {', '  --single-chip-accent: #059669;', '}'),
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
    expect(css).toContain('.single-chip');
    expect(css).toContain('.single-panel');
    expect(css).not.toMatch(/\.Badge_badge_/);
    expect(css).not.toMatch(/\.Tag_tag_/);
  });

  test('emits CSS Modules assets outside the global style aggregate', () => {
    expect(
      readDist(singlePackage, 'es/components/Badge/Badge.module.css'),
    ).toMatch(/\.Badge_badge_/);
    expect(readDist(singlePackage, 'es/components/Tag/Tag.module.css')).toMatch(
      /\.Tag_tag_/,
    );
    expect(
      readDist(singlePackage, 'es/components/Tag/Tag.module.css'),
    ).toContain('@import "./tokens.css"');
    expect(
      readDist(singlePackage, 'es/components/Tag/Tag.module.css'),
    ).toContain('color: var(--tag-color)');
    expect(readDist(singlePackage, 'es/components/Tag/tokens.css')).toContain(
      '--tag-color: #0f766e',
    );
    expect(readDist(singlePackage, 'es/components/Badge/index.js')).toContain(
      'Badge.module.css.js',
    );
    expect(readDist(singlePackage, 'es/components/Tag/index.js')).toContain(
      'Tag.module.less.js',
    );
    expect(
      readDist(singlePackage, 'lib/components/Badge/Badge.module.css.js'),
    ).toContain('require("./Badge.module.css")');
    expect(
      readDist(singlePackage, 'lib/components/Tag/Tag.module.less.js'),
    ).toContain('require("./Tag.module.css")');
  });

  test('emits bundle, module, and style files', () => {
    expect(listDistFiles(singlePackage)).toEqual([
      'components/Badge/Badge.module.css',
      'components/Tag/Tag.module.css',
      'components/Tag/tokens.css',
      'es/components/Badge/Badge.module.css',
      'es/components/Badge/Badge.module.css.js',
      'es/components/Badge/index.d.ts',
      'es/components/Badge/index.js',
      'es/components/Badge/style/index.css',
      'es/components/Button/index.css',
      'es/components/Button/index.d.ts',
      'es/components/Button/index.js',
      'es/components/Button/style/index.css',
      'es/components/Chip/index.css',
      'es/components/Chip/index.d.ts',
      'es/components/Chip/index.js',
      'es/components/Chip/style/index.css',
      'es/components/Chip/tokens.css',
      'es/components/Panel/index.css',
      'es/components/Panel/index.d.ts',
      'es/components/Panel/index.js',
      'es/components/Panel/style/index.css',
      'es/components/Tag/Tag.module.css',
      'es/components/Tag/Tag.module.less.js',
      'es/components/Tag/index.d.ts',
      'es/components/Tag/index.js',
      'es/components/Tag/style/index.css',
      'es/components/Tag/tokens.css',
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
      'lib/components/Badge/Badge.module.css',
      'lib/components/Badge/Badge.module.css.js',
      'lib/components/Badge/index.d.ts',
      'lib/components/Badge/index.js',
      'lib/components/Badge/style/index.css',
      'lib/components/Button/index.css',
      'lib/components/Button/index.d.ts',
      'lib/components/Button/index.js',
      'lib/components/Button/style/index.css',
      'lib/components/Chip/index.css',
      'lib/components/Chip/index.d.ts',
      'lib/components/Chip/index.js',
      'lib/components/Chip/style/index.css',
      'lib/components/Chip/tokens.css',
      'lib/components/Panel/index.css',
      'lib/components/Panel/index.d.ts',
      'lib/components/Panel/index.js',
      'lib/components/Panel/style/index.css',
      'lib/components/Tag/Tag.module.css',
      'lib/components/Tag/Tag.module.less.js',
      'lib/components/Tag/index.d.ts',
      'lib/components/Tag/index.js',
      'lib/components/Tag/style/index.css',
      'lib/components/Tag/tokens.css',
      'lib/index.css',
      'lib/index.d.ts',
      'lib/index.js',
      'lib/style/external.css',
      'lib/style/index.css',
      'lib/style/module.css',
    ]);
  });
});
