import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildPackageStyles, createE2eProject } from './helpers';
import type { VirtualProject } from '../fixtures/virtualProject';

describe('single lib smoke', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createE2eProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('supports single lib packages without style output', async () => {
    project.writePackageJson({ name: '@scope/single-lib' });
    project.writeFile('src/index.ts', 'export const value = 1;');

    await buildPackageStyles(project.root, {
      source: 'src',
      output: 'dist',
    });

    expect(project.exists('dist/index.css')).toBe(false);
  });
});
