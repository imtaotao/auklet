import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildPackageStyles,
  createE2eProject,
  writeMonorepoWorkspace,
} from './helpers';
import type { VirtualProject } from '../fixtures/virtualProject';

describe('monorepo lib smoke', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createE2eProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('supports monorepo lib packages without style output', async () => {
    writeMonorepoWorkspace(project);
    project.writeJson('packages/math/package.json', { name: '@scope/math' });
    project.writeFile('packages/math/src/index.ts', 'export const value = 1;');

    await buildPackageStyles(project.resolve('packages/math'), {
      source: 'src',
      output: 'dist',
    });

    expect(project.exists('packages/math/dist/index.css')).toBe(false);
  });
});
