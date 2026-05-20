import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ui = 'examples/components/packages/ui';
const dashboard = 'examples/components/packages/dashboard';

const readDist = (packageDir: string, file: string) => {
  return fs.readFileSync(path.join(process.cwd(), packageDir, 'dist', file), {
    encoding: 'utf8',
  });
};

const lines = (...values: Array<string>) => `${values.join('\n')}\n`;

describe('examples CSS dependencies', () => {
  test('keeps package-level style imports', () => {
    expect(readDist(ui, 'es/style/index.css')).toBe(
      lines(
        '@import "@demo/theme/style.css";',
        '@import "./themes/light.css";',
        '@import "./themes/dark.css";',
        '@import "./module.css";',
      ),
    );
    expect(readDist(dashboard, 'es/style/index.css')).toBe(
      lines('@import "@demo/ui/style.css";', '@import "./module.css";'),
    );
  });

  test('keeps external style dependency chains', () => {
    expect(readDist(ui, 'es/style/external.css')).toBe(
      lines('@import "@demo/theme/external.css";'),
    );
    expect(readDist(dashboard, 'es/style/external.css')).toBe(
      lines('@import "@demo/ui/external.css";'),
    );
  });

  test('keeps theme style dependency chains', () => {
    expect(readDist(ui, 'es/themes/light.css')).toBe(
      lines(
        '@import "@demo/theme/themes/light.css";',
        '@import "../style/themes/light.css";',
      ),
    );
    expect(readDist(dashboard, 'es/themes/light.css')).toBe(
      lines('@import "@demo/ui/themes/light.css";'),
    );
    expect(readDist(dashboard, 'lib/themes/dark.css')).toBe(
      lines('@import "@demo/ui/themes/dark.css";'),
    );
  });

  test('keeps component style dependency chains', () => {
    expect(readDist(ui, 'es/components/Card/style/index.css')).toBe(
      lines(
        '@import "../../Button/style/index.css";',
        '@import "../index.css";',
      ),
    );
    expect(readDist(dashboard, 'es/components/Dashboard/style/index.css')).toBe(
      lines(
        '@import "@demo/ui/components/Button.css";',
        '@import "@demo/ui/components/Card.css";',
        '@import "../index.css";',
      ),
    );
  });

  test('bundles local and dependency CSS content', () => {
    const css = readDist(dashboard, 'index.css');

    expect(css).toContain('.demo-button');
    expect(css).toContain('.demo-card');
    expect(css).toContain('.dashboard');
  });
});
