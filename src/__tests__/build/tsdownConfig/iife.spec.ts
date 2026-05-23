import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defineKernelPackageConfigFromOptions } from '#auklet/build/tsdownConfig';
import type { VirtualProject } from '../../fixtures/virtualProject';
import { createTsdownProject } from './helpers';

describe('defineKernelPackageConfigFromOptions iife config', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createTsdownProject();
  });

  afterEach(() => {
    project.cleanup();
  });

  test('merges manual externals into iife peer externals', async () => {
    project.writePackageJson({
      name: '@scope/fixture-package',
      version: '1.2.3',
      author: 'tester',
      dependencies: {
        '@scope/runtime': '^1.0.0',
        aidly: '^1.0.0',
      },
      peerDependencies: {
        react: '^19.0.0',
      },
    });

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['iife'],
        externals: ['react-dom'],
        mainFields: ['module', 'main'],
        globals: {
          react: 'ReactRuntime',
          'react-dom': 'ReactDOM',
        },
      },
    });
    const inputOptions = configs[0].inputOptions;

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      format: 'iife',
      deps: {
        neverBundle: ['react', 'react-dom'],
        alwaysBundle: expect.any(Function),
        onlyBundle: false,
      },
      outputOptions: {
        globals: {
          react: 'ReactRuntime',
          'react-dom': 'ReactDOM',
        },
      },
    });
    const alwaysBundle = configs[0].deps?.alwaysBundle;

    if (typeof alwaysBundle !== 'function') {
      throw new Error('Expected iife deps.alwaysBundle to be a function');
    }
    expect(alwaysBundle('aidly', undefined)).toBe(true);
    expect(alwaysBundle('aidly/subpath', undefined)).toBe(true);
    expect(alwaysBundle('@scope/runtime', undefined)).toBe(true);
    expect(alwaysBundle('@scope/runtime/components/Button', undefined)).toBe(
      true,
    );
    expect(alwaysBundle('react', undefined)).toBe(false);
    expect(alwaysBundle('react-dom/client', undefined)).toBe(false);
    expect(alwaysBundle('react/jsx-runtime', undefined)).toBe(true);
    expect(alwaysBundle('react/jsx-dev-runtime', undefined)).toBe(true);
    expect(alwaysBundle('unknown-package', undefined)).toBe(false);
    expect(inputOptions).toEqual(expect.any(Function));
    if (typeof inputOptions !== 'function') {
      throw new Error('Expected bundle config to define inputOptions');
    }
    await expect(
      Promise.resolve(
        inputOptions(
          {
            resolve: {
              alias: {
                react: 'preact/compat',
              },
              conditionNames: ['import', 'default'],
            },
          },
          'iife',
          { cjsDts: false },
        ),
      ),
    ).resolves.toMatchObject({
      resolve: {
        alias: {
          react: 'preact/compat',
        },
        conditionNames: ['import', 'default'],
        mainFields: ['module', 'main'],
      },
    });
  });
});
