import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { baseConfig, createBuilder } from './helpers';

describe('ModuleStyleBuilder package output', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-builder-');
    fixture.writePackageJson({ name: 'fixture-package' });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('uses process cwd as the default package root', async () => {
    fixture.writeFile('auklet.config.ts', 'export const config = {};');
    fixture.writeFile('src/index.tsx', 'export const value = 1;');
    fixture.writeFile('src/index.css', '.root { color: red; }');

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture.root);

    try {
      await new ModuleStyleBuilder().build();
    } finally {
      cwd.mockRestore();
    }

    const rootStyle = fixture.readFile('dist/index.css');

    expect(rootStyle).toContain('.root { color: red; }');
  });

  test('builds only package CSS when module output is disabled', async () => {
    fixture.writeFile(
      'source/components/Button/index.tsx',
      'export const Button = null;',
    );
    fixture.writeFile('source/components/Button/index.css', '.button {}');

    await createBuilder(fixture, baseConfig).build();

    const packageStyle = fixture.readFile('output/index.css');

    expect(packageStyle).toContain('.button {}');
    expect(fixture.exists('output/es/style/index.css')).toBe(false);
    expect(fixture.exists('output/es/components/Button/style/index.css')).toBe(
      false,
    );
    expect(fixture.exists('output/lib/style/index.css')).toBe(false);
  });
});
