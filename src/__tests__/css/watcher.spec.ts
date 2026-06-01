import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const mocks = vi.hoisted(() => {
  const events = new Map<string, (...args: Array<unknown>) => void>();
  const close = vi.fn().mockResolvedValue(undefined);
  const watch = vi.fn(function watch() {
    return {
      close,
      on: vi.fn(function on(
        event: string,
        callback: (...args: Array<unknown>) => void,
      ) {
        events.set(event, callback);
        return undefined;
      }),
    };
  });
  const build = vi.fn(function build() {
    return Promise.resolve();
  });
  const createBuilder = vi.fn(function createBuilder(
    context: Record<string, unknown>,
  ) {
    builderContexts.push(context);
    return {
      build,
    };
  });
  const builderContexts: Array<Record<string, unknown>> = [];

  return {
    build,
    builderContexts,
    close,
    createBuilder,
    events,
    watch,
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: mocks.watch,
  },
}));

vi.mock('#auklet/css/production/builder', () => ({
  ModuleStyleBuilder: mocks.createBuilder,
}));

import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import type { AukletConfig } from '#auklet/types';

describe('ModuleStyleWatcher', () => {
  let project: VirtualProject;

  beforeEach(() => {
    vi.useFakeTimers();
    project = createVirtualProject('auklet-watcher-');
    mocks.build.mockReset();
    mocks.build.mockResolvedValue(undefined);
    mocks.builderContexts.length = 0;
    mocks.close.mockClear();
    mocks.createBuilder.mockClear();
    mocks.events.clear();
    mocks.watch.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    project.cleanup();
  });

  test('watches configured source root and auklet config file', async () => {
    const aukletConfig: AukletConfig = {
      source: 'source',
    };
    project.writeFile('source/index.tsx', 'export const value = 1;');
    project.writeFile('auklet.config.js', 'export const config = {};');

    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
      aukletConfig,
    });

    await watcher.watch();

    expect(mocks.builderContexts[0]).toMatchObject({
      packageRoot: project.root,
      aukletConfig,
    });
    expect(mocks.watch).toHaveBeenCalledWith(
      [
        path.join(project.root, 'source'),
        path.join(project.root, 'auklet.config.js'),
      ],
      {
        ignoreInitial: true,
        interval: 300,
        usePolling: true,
      },
    );
    await watcher.close();
  });

  test('debounces file events into a rebuild', async () => {
    project.writeFile('src/index.tsx', 'export const value = 1;');
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
    });

    await watcher.watch();
    mocks.events.get('all')?.();
    mocks.events.get('all')?.();
    await vi.advanceTimersByTimeAsync(80);

    expect(mocks.build).toHaveBeenCalledTimes(2);

    await watcher.close();
  });

  test('rebuilds for component, style, and config changes only', async () => {
    project.writeFile('src/index.tsx', 'export const value = 1;');
    project.writeFile('src/index.css', '.root {}');
    project.writeFile('src/data.ts', 'export const value = 1;');
    project.writeFile('auklet.config.js', 'export const config = {};');
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
    });

    await watcher.watch();
    expect(mocks.build).toHaveBeenCalledTimes(1);

    mocks.events.get('all')?.('change', project.resolve('src/data.ts'));
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(1);

    mocks.events.get('all')?.('change', project.resolve('src/index.tsx'));
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(2);

    mocks.events.get('all')?.('change', project.resolve('src/index.css'));
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(3);

    mocks.events.get('all')?.('change', project.resolve('auklet.config.js'));
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(4);

    await watcher.close();
  });

  test('keeps watching when the initial build fails', async () => {
    const logger = {
      error: vi.fn(),
    };
    project.writeFile('src/index.tsx', 'export const value = 1;');
    mocks.build
      .mockRejectedValueOnce(new Error('build failed'))
      .mockResolvedValueOnce(undefined);
    const watcher = new ModuleStyleWatcher(
      {
        packageRoot: project.root,
      },
      moduleStyleBuildConfig,
      logger,
    );

    await watcher.watch();
    mocks.events.get('all')?.('change', project.resolve('src/index.tsx'));
    await vi.advanceTimersByTimeAsync(80);

    expect(mocks.watch).toHaveBeenCalledTimes(2);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'CSS build failed; waiting for changes.',
    );

    await watcher.close();
  });

  test('recovers from file watcher errors with a rebuild', async () => {
    const logger = {
      error: vi.fn(),
    };
    project.writeFile('src/index.tsx', 'export const value = 1;');
    const watcher = new ModuleStyleWatcher(
      {
        packageRoot: project.root,
      },
      moduleStyleBuildConfig,
      logger,
    );

    await watcher.watch();
    expect(mocks.createBuilder).toHaveBeenCalledTimes(1);
    expect(mocks.watch).toHaveBeenCalledTimes(1);
    expect(mocks.events.has('error')).toBe(true);
    const error = new Error('watch failed');
    mocks.events.get('error')?.(error);

    expect(logger.error).toHaveBeenCalledWith(
      'CSS watcher error; waiting for changes.',
    );
    expect(logger.error).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.watch).toHaveBeenCalledTimes(2);

    await watcher.close();
  });

  test('limits repeated watcher error logs while keeping recovery rebuilds', async () => {
    const logger = {
      error: vi.fn(),
    };
    project.writeFile('src/index.tsx', 'export const value = 1;');
    const watcher = new ModuleStyleWatcher(
      {
        packageRoot: project.root,
      },
      moduleStyleBuildConfig,
      logger,
    );

    vi.setSystemTime(2_000);
    await watcher.watch();
    mocks.events.get('error')?.(new Error('first watch error'));
    await vi.advanceTimersByTimeAsync(80);
    mocks.events.get('error')?.(new Error('second watch error'));
    await vi.advanceTimersByTimeAsync(80);

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(mocks.build).toHaveBeenCalledTimes(3);

    vi.setSystemTime(4_000);
    mocks.events.get('error')?.(new Error('third watch error'));

    expect(logger.error).toHaveBeenCalledTimes(4);

    await watcher.close();
  });

  test('ignores file events after close', async () => {
    project.writeFile('src/index.tsx', 'export const value = 1;');
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
    });

    await watcher.watch();
    await watcher.close();
    mocks.events.get('all')?.('change', project.resolve('src/index.tsx'));
    await vi.advanceTimersByTimeAsync(80);

    expect(mocks.build).toHaveBeenCalledTimes(1);
  });

  test('does not create a watcher when closed during a build', async () => {
    let resolveBuild!: () => void;
    const buildPromise = new Promise<void>((resolve) => {
      resolveBuild = resolve;
    });
    mocks.build.mockReturnValueOnce(buildPromise);
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
    });

    const watchPromise = watcher.watch();
    await Promise.resolve();
    await watcher.close();
    resolveBuild();
    await watchPromise;

    expect(mocks.watch).not.toHaveBeenCalled();
  });
});
