import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import {
  buildPackageStyles,
  createE2eProject,
  writeComponentPackage,
} from './helpers';
import type { VirtualProject } from '../fixtures/virtualProject';

describe('single package smoke', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createE2eProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('supports single component packages', async () => {
    writeComponentPackage(project, '', '@scope/single');

    await buildPackageStyles(project.root, {
      source: 'src',
      output: 'dist',
      modules: true,
    });

    expect(project.exists('dist/es/components/Button/style/index.css')).toBe(
      true,
    );

    const graph = new ModuleStyleGraph({
      root: project.root,
    });
    const result = await graph.createPackageStyleCode({
      packageName: '@scope/single',
      stylePath: 'style.css',
    });

    expect(result.code).toContain('.button {}');
    expect(result.code).toContain('.root {}');
  });
});
