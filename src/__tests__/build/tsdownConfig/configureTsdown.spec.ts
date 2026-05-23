import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineKernelPackageConfigFromOptions } from '#auklet/build/tsdownConfig';
import type { VirtualProject } from '../../fixtures/virtualProject';
import { createTsdownProject } from './helpers';

describe('defineKernelPackageConfigFromOptions configureTsdown', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createTsdownProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('allows final tsdown config customization', () => {
    const configureTsdown = vi.fn((config, context) => {
      return {
        ...config,
        name: `${context.kind}:${context.format}:${context.packageName}`,
        sourcemap: context.kind === 'bundle',
        outputOptions: {
          ...config.outputOptions,
          globals: {
            ...config.outputOptions?.globals,
            react: 'CustomReact',
          },
        },
      };
    });

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      modules: true,
      build: {
        formats: ['iife'],
        configureTsdown,
      },
    });

    expect(configureTsdown).toHaveBeenCalledTimes(3);
    expect(configureTsdown.mock.calls.map(([, context]) => context)).toEqual([
      {
        kind: 'bundle',
        format: 'iife',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
      {
        kind: 'module',
        format: 'esm',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
      {
        kind: 'module',
        format: 'cjs',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
    ]);
    expect(configs[0]).toMatchObject({
      name: 'bundle:iife:@scope/fixture-package',
      sourcemap: true,
      outputOptions: {
        globals: {
          react: 'CustomReact',
        },
      },
    });
    expect(configs[1]).toMatchObject({
      name: 'module:esm:@scope/fixture-package',
      sourcemap: false,
    });
  });
});
