import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const mocks = vi.hoisted(() => {
  const events = new Map<string, (...args: Array<unknown>) => void>();
  const close = vi.fn().mockResolvedValue(undefined);
  const watch = vi.fn(() => ({
    close,
    on: vi.fn((event: string, callback: (...args: Array<unknown>) => void) => {
      events.set(event, callback);
      return undefined;
    }),
  }));
  const build = vi.fn().mockResolvedValue(undefined);
  const builderContexts: Array<Record<string, unknown>> = [];

  return {
    build,
    builderContexts,
    close,
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
  ModuleStyleBuilder: vi.fn((context: Record<string, unknown>) => {
    mocks.builderContexts.push(context);
    return {
      build: mocks.build,
    };
  }),
}));

import { ModuleStyleWatcher } from '#auklet/css/watch/watcher';
import type { AukletConfig, AukletLogger } from '#auklet/types';

describe('ModuleStyleWatcher', () => {
  let project: VirtualProject;
  let logger: Required<AukletLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    project = createVirtualProject('auklet-watcher-');
    logger = {
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };
    mocks.build.mockClear();
    mocks.builderContexts.length = 0;
    mocks.close.mockClear();
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
    project.writeFile('auklet.config.ts', 'export const config = {};');

    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
      aukletConfig,
      logger,
    });

    await watcher.watch();

    expect(mocks.builderContexts[0]).toMatchObject({
      packageRoot: project.root,
      aukletConfig,
      logger,
    });
    expect(mocks.watch).toHaveBeenCalledWith(
      [
        path.join(project.root, 'source'),
        path.join(project.root, 'auklet.config.ts'),
      ],
      {
        ignoreInitial: true,
        interval: 300,
        usePolling: true,
      },
    );
    expect(logger.log).toHaveBeenCalledWith('[auklet:css] watch mode ready');

    await watcher.close();
  });

  test('debounces file events into a rebuild', async () => {
    project.writeFile('src/index.tsx', 'export const value = 1;');
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
      logger,
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
    project.writeFile('auklet.config.ts', 'export const config = {};');
    const watcher = new ModuleStyleWatcher({
      packageRoot: project.root,
      logger,
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

    mocks.events.get('all')?.('change', project.resolve('auklet.config.ts'));
    await vi.advanceTimersByTimeAsync(80);
    expect(mocks.build).toHaveBeenCalledTimes(4);

    await watcher.close();
  });
});
