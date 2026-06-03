import { afterEach, describe, expect, test } from 'vitest';
import {
  findNpmrcWithAuthToken,
  hasAuthToken,
  toNpmrcRegistryKey,
  validateNpmrcAuthEnv,
} from '#auklet/publish/api/npmrc';
import {
  createVirtualProject,
  type VirtualProject,
} from '#auklet/__tests__/fixtures/virtualProject';

describe('npmrc auth config', () => {
  let project: VirtualProject | null = null;

  afterEach(() => {
    project?.cleanup();
    project = null;
  });

  test('finds a root npmrc auth token for workspace child packages', () => {
    project = createVirtualProject();
    project.writeFile(
      '.npmrc',
      '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '1.0.0',
    });

    expect(
      findNpmrcWithAuthToken(
        project.resolve('packages/ui'),
        project.root,
        'https://registry.npmjs.org/',
      ),
    ).toBe(project.resolve('.npmrc'));
  });

  test('requires auth token config for the package publish registry', () => {
    const content = [
      '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
      '//registry.example.test/:always-auth=true',
    ].join('\n');

    expect(hasAuthToken(content, 'https://registry.example.test/')).toBe(false);
    expect(
      hasAuthToken(
        `${content}\n//registry.example.test/:_authToken=\${NODE_AUTH_TOKEN}`,
        'https://registry.example.test/',
      ),
    ).toBe(true);
  });

  test('normalizes registry urls to npmrc auth keys', () => {
    expect(toNpmrcRegistryKey('https://registry.example.test/npm')).toBe(
      '//registry.example.test/npm/',
    );
  });

  test('reports invalid package publish registry with publish context', () => {
    expect(() => toNpmrcRegistryKey('not a registry')).toThrow(
      '[publish] invalid publishConfig.registry: not a registry',
    );
  });

  test('reports missing npmrc auth environment before pnpm reads npmrc', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    currentProject.writeFile(
      '.npmrc',
      '//registry.npmjs.org/:_authToken=${AUKLET_MISSING_TOKEN}\n',
    );

    expect(() =>
      validateNpmrcAuthEnv(currentProject.root, currentProject.root),
    ).toThrow('npmrc auth environment is missing: AUKLET_MISSING_TOKEN');
  });

  test('allows --token to satisfy NODE_AUTH_TOKEN npmrc references', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    currentProject.writeFile(
      '.npmrc',
      '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n',
    );

    expect(() =>
      validateNpmrcAuthEnv(currentProject.root, currentProject.root, {
        token: 'npm_secret',
      }),
    ).not.toThrow();
  });
});
