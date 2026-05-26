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
import type { AukletConfig } from '#auklet/types';

describe('ModuleStyleWatcher', () => {
  let project: VirtualProject;

  beforeEach(() => {
    vi.useFakeTimers();
    project = createVirtualProject('auklet-watcher-');
    mocks.build.mockClear();
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
});
