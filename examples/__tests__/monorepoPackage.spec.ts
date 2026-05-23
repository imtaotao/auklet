import { describe, expect, test } from 'vitest';
import { lines, listDistFiles, readDist } from './helpers';

const ui = 'examples/monorepo-package/packages/ui';
const dashboard = 'examples/monorepo-package/packages/dashboard';
const reexports = 'examples/monorepo-package/packages/reexports';

describe('monorepo package example', () => {
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
    expect(readDist(reexports, 'es/style/index.css')).toBe(
      lines('@import "@demo/ui/style.css";', '@import "./module.css";'),
    );
  });

  test('keeps external and theme style dependency chains', () => {
    expect(readDist(ui, 'es/style/external.css')).toBe(
      lines('@import "@demo/theme/external.css";'),
    );
    expect(readDist(dashboard, 'es/style/external.css')).toBe(
      lines('@import "@demo/ui/external.css";'),
    );
    expect(readDist(reexports, 'es/style/external.css')).toBe(
      lines('@import "@demo/ui/external.css";'),
    );
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

  test('keeps module style dependency chains', () => {
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
    expect(
      readDist(reexports, 'es/components/PackageReexport/style/index.css'),
    ).toBe(
      lines(
        '@import "@demo/ui/components/Button.css";',
        '@import "../index.css";',
      ),
    );
    expect(
      readDist(reexports, 'es/components/DeepReexport/style/index.css'),
    ).toBe(
      lines(
        '@import "@demo/ui/components/Card.css";',
        '@import "../index.css";',
      ),
    );
    expect(
      readDist(reexports, 'es/components/LocalReexport/style/index.css'),
    ).toBe(
      lines(
        '@import "@demo/ui/components/Card.css";',
        '@import "../index.css";',
      ),
    );
  });

  test('bundles local and dependency CSS content', () => {
    const dashboardCss = readDist(dashboard, 'index.css');
    const reexportsCss = readDist(reexports, 'index.css');

    expect(dashboardCss).toContain('.demo-button');
    expect(dashboardCss).toContain('.demo-card');
    expect(dashboardCss).toContain('.dashboard');
    expect(reexportsCss).toContain('.package-reexport');
    expect(reexportsCss).toContain('.deep-reexport');
    expect(reexportsCss).toContain('.local-reexport');
  });

  test('keeps workspace JavaScript dependencies external', () => {
    const importUi = 'import { Button, Card } from "@demo/ui";';

    expect(readDist(dashboard, 'index.js')).toContain(importUi);
    expect(readDist(dashboard, 'es/components/Dashboard/index.js')).toContain(
      importUi,
    );
    expect(readDist(dashboard, 'index.cjs')).toContain('require("@demo/ui")');
    expect(
      readDist(reexports, 'es/components/PackageReexport/index.js'),
    ).toContain('import { Button as ReexportedButton } from "@demo/ui";');
    expect(
      readDist(reexports, 'es/components/DeepReexport/index.js'),
    ).toContain(
      'import { Card as ReexportedCard } from "@demo/ui/components/Card";',
    );
    expect(
      readDist(reexports, 'es/components/LocalReexport/index.js'),
    ).toContain('import { Card as ImportedCard } from "@demo/ui";');
    expect(readDist(reexports, 'index.cjs')).toContain('require("@demo/ui")');
  });

  test('uses relative imports inside module output', () => {
    expect(readDist(ui, 'es/components/Card/index.js')).toContain(
      'import { Button } from "../Button/index.js";',
    );
  });

  test('emits bundle, module, and style files', () => {
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
    expect(listDistFiles(reexports)).toEqual([
      'es/components/DeepReexport/index.css',
      'es/components/DeepReexport/index.d.ts',
      'es/components/DeepReexport/index.js',
      'es/components/DeepReexport/style/index.css',
      'es/components/LocalReexport/index.css',
      'es/components/LocalReexport/index.d.ts',
      'es/components/LocalReexport/index.js',
      'es/components/LocalReexport/style/index.css',
      'es/components/LocalReexport/types.d.ts',
      'es/components/LocalReexport/types.js',
      'es/components/PackageReexport/index.css',
      'es/components/PackageReexport/index.d.ts',
      'es/components/PackageReexport/index.js',
      'es/components/PackageReexport/style/index.css',
      'es/index.d.ts',
      'es/index.js',
      'es/style/external.css',
      'es/style/index.css',
      'es/style/module.css',
      'index.cjs',
      'index.css',
      'index.d.ts',
      'index.js',
      'index.mjs',
      'lib/components/DeepReexport/index.css',
      'lib/components/DeepReexport/index.d.ts',
      'lib/components/DeepReexport/index.js',
      'lib/components/DeepReexport/style/index.css',
      'lib/components/LocalReexport/index.css',
      'lib/components/LocalReexport/index.d.ts',
      'lib/components/LocalReexport/index.js',
      'lib/components/LocalReexport/style/index.css',
      'lib/components/LocalReexport/types.d.ts',
      'lib/components/LocalReexport/types.js',
      'lib/components/PackageReexport/index.css',
      'lib/components/PackageReexport/index.d.ts',
      'lib/components/PackageReexport/index.js',
      'lib/components/PackageReexport/style/index.css',
      'lib/index.d.ts',
      'lib/index.js',
      'lib/style/external.css',
      'lib/style/index.css',
      'lib/style/module.css',
    ]);
  });
});
