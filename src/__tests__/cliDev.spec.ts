import { beforeEach, describe, expect, test, vi } from 'vitest';
import { aukletCliConfigOverridesEnv } from '#auklet/build/cliOverrides';

const mocks = vi.hoisted(() => {
  const cssWatch = vi.fn().mockResolvedValue(undefined);
  const cssClose = vi.fn().mockResolvedValue(undefined);
  const cssWatcherContexts: Array<Record<string, unknown>> = [];
  const createCssWatcher = vi.fn(function createCssWatcher(
    context: Record<string, unknown>,
  ) {
    cssWatcherContexts.push(context);
    return {
      close: cssClose,
      watch: cssWatch,
    };
  });
  const jsKill = vi.fn();
  const execa = vi.fn(() =>
    Object.assign(Promise.resolve({ exitCode: 0 }), {
      kill: jsKill,
    }),
  );
  const loadAukletConfig = vi.fn().mockResolvedValue({
    modules: false,
    output: 'dist',
    source: 'src',
  });

  return {
    createCssWatcher,
    cssClose,
    cssWatch,
    cssWatcherContexts,
    execa,
    jsKill,
    loadAukletConfig,
  };
});

vi.mock('execa', () => ({
  execa: mocks.execa,
}));

vi.mock('#auklet/configLoader', () => ({
  loadAukletConfig: mocks.loadAukletConfig,
}));

vi.mock('#auklet/css/watch/watcher', () => ({
  ModuleStyleWatcher: mocks.createCssWatcher,
}));

vi.mock('#auklet/logger', () => ({
  createAukletLogger: () => ({
    child: () => ({
      success: vi.fn(),
    }),
    group: async (_title: string, callback: () => Promise<unknown>) =>
      callback(),
  }),
}));

import { runDev } from '#auklet/cli/dev';

describe('runDev', () => {
  beforeEach(() => {
    mocks.createCssWatcher.mockClear();
    mocks.cssClose.mockClear();
    mocks.cssWatch.mockClear();
    mocks.cssWatcherContexts.length = 0;
    mocks.execa.mockClear();
    mocks.jsKill.mockClear();
    mocks.loadAukletConfig.mockClear();
  });

  test('passes build overrides to JavaScript watch env and CSS watcher config', async () => {
    await runDev(['--source', 'source', '--modules']);

    const [, , options] = mocks.execa.mock.calls[0] as unknown as [
      string,
      Array<string>,
      { env?: Record<string, string> },
    ];
    expect(
      JSON.parse(options.env?.[aukletCliConfigOverridesEnv] ?? '{}'),
    ).toEqual({
      modules: true,
      source: 'source',
    });
    expect(mocks.cssWatcherContexts[0]).toEqual({
      aukletConfig: {
        modules: true,
        output: 'dist',
        source: 'source',
      },
    });
  });

  test('closes CSS watcher when JavaScript watch exits', async () => {
    await runDev(['--source', 'source', '--modules']);

    expect(mocks.cssWatch).toHaveBeenCalledTimes(1);
    expect(mocks.jsKill).toHaveBeenCalledWith('SIGTERM');
    expect(mocks.cssClose).toHaveBeenCalledTimes(1);
  });
});
