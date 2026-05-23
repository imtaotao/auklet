import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineKernelPackageConfigFromFile } from '#auklet/build/tsdownConfig';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('defineKernelPackageConfigFromFile', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-tsdown-file-');
    project.writePackageJson({
      name: 'fixture-package',
      version: '1.0.0',
    });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('loads auklet config from the package root', async () => {
    project.writeFile(
      'auklet.config.ts',
      `
        export const config = {
          build: {
            formats: ['cjs'],
          },
        };
      `,
    );

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(project.root);
    try {
      const configs = await defineKernelPackageConfigFromFile();
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        cwd: project.root,
        format: 'cjs',
        outDir: 'dist',
      });
    } finally {
      cwd.mockRestore();
    }
  });
});
