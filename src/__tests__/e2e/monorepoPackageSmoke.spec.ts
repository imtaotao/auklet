import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { collectStyleImports } from '../fixtures/styleStructure';
import type { VirtualProject } from '../fixtures/virtualProject';
import {
  buildPackageStyles,
  createE2eProject,
  writeComponentPackage,
  writeMonorepoWorkspace,
} from './helpers';

describe('monorepo package smoke', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createE2eProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('supports monorepo component packages', async () => {
    writeMonorepoWorkspace(project);
    writeComponentPackage(project, 'packages/ui', '@scope/ui');

    await buildPackageStyles(project.resolve('packages/ui'), {
      source: 'src',
      output: 'dist',
      modules: true,
    });

    expect(
      project.exists('packages/ui/dist/es/components/Button/style/index.css'),
    ).toBe(true);
    expect(
      collectStyleImports(
        project.readFile('packages/ui/dist/es/style/index.css'),
      ),
    ).toEqual(['./module.css']);

    const graph = new ModuleStyleGraph({
      root: project.root,
      mode: 'monorepo',
    });
    const result = await graph.createPackageStyleCode({
      packageName: '@scope/ui',
      stylePath: 'components/Button.css',
    });

    expect(result.code).toContain('.button {}');
  });
});
