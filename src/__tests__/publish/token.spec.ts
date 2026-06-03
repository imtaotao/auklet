import { afterEach, describe, expect, test } from 'vitest';
import { createDeferredCliValue } from '#auklet/cli/parse/values';
import { AukletEnvContext } from '#auklet/env';
import { createPublishTargetEnv } from '#auklet/publish/publishEnv';
import {
  createVirtualProject,
  type VirtualProject,
} from '#auklet/__tests__/fixtures/virtualProject';

describe('publish token', () => {
  let project: VirtualProject | null = null;

  afterEach(() => {
    project?.cleanup();
    project = null;
  });

  test('keeps literal token values', () => {
    const currentProject = createVirtualProject();
    project = currentProject;

    expect(
      createPublishTargetEnv(
        {
          token: createDeferredCliValue('npm_secret', { label: '--token' }),
        },
        { envContext: new AukletEnvContext(currentProject.root) },
        { packageRoot: currentProject.root },
      ),
    ).toEqual({
      env: {
        NODE_AUTH_TOKEN: 'npm_secret',
        NPM_TOKEN: 'npm_secret',
      },
      token: 'npm_secret',
    });
  });

  test('resolves env token values from package env before root env', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    currentProject.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n',
    );
    currentProject.writeFile('.env', 'NODE_AUTH_TOKEN=root-token\n');
    currentProject.writeFile(
      'packages/ui/.env',
      'NODE_AUTH_TOKEN=package-token\n',
    );

    expect(
      createPublishTargetEnv(
        {
          token: createDeferredCliValue('env:NODE_AUTH_TOKEN', {
            label: '--token',
          }),
        },
        { envContext: new AukletEnvContext(currentProject.root) },
        { packageRoot: currentProject.resolve('packages/ui') },
      ),
    ).toEqual({
      env: {
        NODE_AUTH_TOKEN: 'package-token',
        NPM_TOKEN: 'package-token',
      },
      token: 'package-token',
    });
  });

  test('keeps package env priority when root env is injected during publish', async () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    const originalToken = process.env.NODE_AUTH_TOKEN;
    currentProject.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n',
    );
    currentProject.writeFile('.env', 'NODE_AUTH_TOKEN=root-token\n');
    currentProject.writeFile(
      'packages/ui/.env',
      'NODE_AUTH_TOKEN=package-token\n',
    );

    try {
      delete process.env.NODE_AUTH_TOKEN;
      const envContext = new AukletEnvContext(currentProject.root);

      await envContext.run(async () => {
        expect(process.env.NODE_AUTH_TOKEN).toBe('root-token');
        expect(
          createPublishTargetEnv(
            {
              token: createDeferredCliValue('env:NODE_AUTH_TOKEN', {
                label: '--token',
              }),
            },
            { envContext },
            { packageRoot: currentProject.resolve('packages/ui') },
          ),
        ).toEqual({
          env: {
            NODE_AUTH_TOKEN: 'package-token',
            NPM_TOKEN: 'package-token',
          },
          token: 'package-token',
        });
      });
    } finally {
      if (originalToken === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = originalToken;
      }
    }
  });

  test('resolves env token values from process env before file env', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    const originalToken = process.env.NODE_AUTH_TOKEN;
    currentProject.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n',
    );
    currentProject.writeFile('.env', 'NODE_AUTH_TOKEN=root-token\n');
    currentProject.writeFile(
      'packages/ui/.env',
      'NODE_AUTH_TOKEN=package-token\n',
    );

    try {
      process.env.NODE_AUTH_TOKEN = 'shell-token';

      expect(
        createPublishTargetEnv(
          {
            token: createDeferredCliValue('env:NODE_AUTH_TOKEN', {
              label: '--token',
            }),
          },
          { envContext: new AukletEnvContext(currentProject.root) },
          { packageRoot: currentProject.resolve('packages/ui') },
        ),
      ).toEqual({
        env: {
          NODE_AUTH_TOKEN: 'shell-token',
          NPM_TOKEN: 'shell-token',
        },
        token: 'shell-token',
      });
    } finally {
      if (originalToken === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = originalToken;
      }
    }
  });

  test('keeps explicit token values before process env', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    const originalToken = process.env.NODE_AUTH_TOKEN;

    try {
      process.env.NODE_AUTH_TOKEN = 'shell-token';

      expect(
        createPublishTargetEnv(
          {
            token: createDeferredCliValue('npm_secret', { label: '--token' }),
          },
          { envContext: new AukletEnvContext(currentProject.root) },
          { packageRoot: currentProject.root },
        ),
      ).toEqual({
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
        token: 'npm_secret',
      });
    } finally {
      if (originalToken === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = originalToken;
      }
    }
  });

  test('reports missing env token values', () => {
    const currentProject = createVirtualProject();
    project = currentProject;

    expect(() =>
      createPublishTargetEnv(
        {
          token: createDeferredCliValue('env:NODE_AUTH_TOKEN', {
            label: '--token',
          }),
        },
        { envContext: new AukletEnvContext(currentProject.root) },
        { packageRoot: currentProject.root },
      ),
    ).toThrow('--token environment is missing: NODE_AUTH_TOKEN');
  });
});
