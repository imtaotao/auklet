import { describe, expect, it } from 'vitest';
import { cleanAukletOutput } from '#auklet/build/cleanOutput';
import { createVirtualProject } from '../fixtures/virtualProject';

describe('cleanAukletOutput', () => {
  it('removes dist by default', async () => {
    const project = createVirtualProject();
    try {
      project.writeFile('dist/index.js', '');

      await cleanAukletOutput(project.root);

      expect(project.exists('dist')).toBe(false);
    } finally {
      project.cleanup();
    }
  });

  it('removes configured output directory', async () => {
    const project = createVirtualProject();
    try {
      project.writeAukletConfig(`
        export const config = {
          output: 'build',
        };
      `);
      project.writeFile('dist/index.js', '');
      project.writeFile('build/index.js', '');

      await cleanAukletOutput(project.root);

      expect(project.exists('build')).toBe(false);
      expect(project.exists('dist')).toBe(true);
    } finally {
      project.cleanup();
    }
  });
});
