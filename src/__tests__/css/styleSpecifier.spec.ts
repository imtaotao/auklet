import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createDevExternalStyleSpecifier,
  createDevModuleStyleSpecifier,
  createExternalStyleSpecifier,
  createOutputModuleStyleSpecifier,
  createOutputOwnStyleSpecifier,
  createOutputStyleSpecifier,
  toRelativeImportSpecifier,
} from '#auklet/css/core/style/specifier';

const outputOptions = {
  currentOutputFormat: 'lib',
  outputFormats: ['es', 'lib'],
  styleDir: 'style',
  indexStyleFile: 'index.css',
  externalStyleFile: 'external.css',
};

describe('style specifier helpers', () => {
  test('creates relative import specifiers', () => {
    expect(
      toRelativeImportSpecifier(
        '/pkg/dist/es/card/style',
        '/pkg/dist/es/card/index.css',
      ),
    ).toBe('../index.css');
    expect(
      toRelativeImportSpecifier(
        '/pkg/dist/es/card/style',
        '/pkg/dist/es/card/style/tokens.css',
      ),
    ).toBe('./tokens.css');
  });

  test('rewrites package style specifiers to output format', () => {
    expect(
      createOutputStyleSpecifier(
        '@scope/ui/es/components/Button/style/index.css',
        outputOptions,
      ),
    ).toBe('@scope/ui/lib/components/Button/style/index.css');
    expect(
      createOutputStyleSpecifier('@scope/ui/style.css', outputOptions),
    ).toBe('@scope/ui/style.css');
  });

  test('rewrites package style entries to external entries', () => {
    expect(
      createExternalStyleSpecifier('@scope/ui/style.css', outputOptions),
    ).toBe('@scope/ui/external.css');
    expect(
      createExternalStyleSpecifier(
        '@scope/ui/es/style/index.css',
        outputOptions,
      ),
    ).toBe('@scope/ui/lib/style/external.css');
    expect(
      createExternalStyleSpecifier(
        '@scope/ui/es/components/Button/style/index.css',
        outputOptions,
      ),
    ).toBe('@scope/ui/es/components/Button/style/index.css');
  });

  test('creates production module style entry specifiers', () => {
    const styleDir = '/pkg/dist/es/components/Card/style';

    expect(
      createOutputModuleStyleSpecifier('../Button/style/index.css', styleDir),
    ).toBe('../Button/style/index.css');
    expect(
      createOutputModuleStyleSpecifier(
        '@scope/ui/components/Button.css',
        styleDir,
      ),
    ).toBe('@scope/ui/components/Button.css');
    expect(
      createOutputModuleStyleSpecifier(
        '/pkg/dist/es/components/Button/style/index.css',
        styleDir,
      ),
    ).toBe('../../Button/style/index.css');
    expect(
      createOutputOwnStyleSpecifier(
        {
          sourceRoot: '/pkg/src',
          outputRoot: '/pkg/dist/es',
          styleDir,
        },
        '/pkg/src/components/Card/index.css',
      ),
    ).toBe('../index.css');
  });

  test('creates Vite dev external style specifiers', () => {
    const options = {
      isKnownPackageName: (packageName: string) => packageName === '@scope/ui',
      styleDir: 'style',
      indexStyleFile: 'index.css',
      externalStyleFile: 'external.css',
    };

    expect(
      createDevExternalStyleSpecifier('@scope/ui/style.css', options),
    ).toBe('@scope/ui/external.css');
    expect(
      createDevExternalStyleSpecifier('@scope/ui/style/index.css', options),
    ).toBe('@scope/ui/external.css');
    expect(
      createDevExternalStyleSpecifier('@scope/other/style.css', options),
    ).toBe('@scope/other/style.css');
  });

  test('creates Vite dev module style specifiers', () => {
    const options = {
      sourceStyleDir: path.join('/pkg/src/components/Card/style'),
      sourceRoot: '/pkg/src',
      packageName: '@scope/app',
      styleDir: 'style',
      indexStyleFile: 'index.css',
      mapExternalSpecifier: (specifier: string) => `external:${specifier}`,
    };

    expect(
      createDevModuleStyleSpecifier('../../Button/style/index.css', options),
    ).toBe('@scope/app/components/Button.css');
    expect(
      createDevModuleStyleSpecifier('@scope/ui/components/Button.css', options),
    ).toBe('external:@scope/ui/components/Button.css');
  });
});
