import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  clearSharedOutputResolveCache,
  setSharedOutputResolveCache,
} from '#auklet/css/core/style/sharedOutput';
import { createAukletViteLessPlugin } from '#auklet/css/vite/viteLessPlugin';
import { normalizeFileKey } from '#auklet/utils';

const tempDirs: Array<string> = [];

afterEach(() => {
  clearSharedOutputResolveCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('createAukletViteLessPlugin', () => {
  test('loads workspace shared.output Less from source and tracks HMR', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auklet-vite-less-'));
    tempDirs.push(root);
    const uiRoot = path.join(root, 'packages/ui');
    const appSrc = path.join(root, 'app/src');
    const sourceTokens = path.join(uiRoot, 'src/shared/tokens.less');
    const distTokens = path.join(uiRoot, 'dist/es/shared/tokens.less');
    fs.mkdirSync(path.dirname(sourceTokens), { recursive: true });
    fs.mkdirSync(path.dirname(distTokens), { recursive: true });
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(path.join(uiRoot, 'package.json'), '{"name":"@demo/ui"}');
    fs.writeFileSync(
      path.join(root, 'app/package.json'),
      JSON.stringify({
        name: '@demo/app',
        dependencies: { '@demo/ui': 'workspace:*' },
      }),
    );
    fs.mkdirSync(path.join(root, 'app/node_modules/@demo'), {
      recursive: true,
    });
    fs.symlinkSync(uiRoot, path.join(root, 'app/node_modules/@demo/ui'));
    fs.writeFileSync(
      path.join(uiRoot, 'package.json'),
      JSON.stringify({
        name: '@demo/ui',
        exports: {
          './shared/tokens.less': {
            less: './dist/es/shared/tokens.less',
            default: './dist/es/shared/tokens.less',
          },
        },
      }),
    );
    fs.writeFileSync(sourceTokens, '@token-demo-bg: #dbeafe;\n');
    fs.writeFileSync(distTokens, '@token-demo-bg: #fef3c7;\n');
    setSharedOutputResolveCache(uiRoot, {
      sourceRoot: path.join(uiRoot, 'src'),
      outputDir: 'dist',
      outputFormats: ['es', 'lib'],
      moduleFileKeys: new Set(),
      plainFileKeys: new Set([normalizeFileKey(sourceTokens)]),
    });

    const trackImport = vi.fn();
    const plugin = createAukletViteLessPlugin({ trackImport });
    const managers: Array<{
      supports: (filename: string, dir: string) => boolean;
      loadFile: (
        filename: string,
        dir: string,
        options: { filename?: string },
        environment: unknown,
      ) => Promise<{ filename: string; contents: string }>;
    }> = [];
    plugin.install({} as never, {
      addFileManager: (manager) => {
        managers.push(manager as never);
      },
    });

    expect(managers).toHaveLength(1);
    const manager = managers[0]!;
    expect(manager.supports('@demo/ui/shared/tokens.less', appSrc)).toBe(true);
    const entryLess = path.join(appSrc, 'tokens-demo.less');
    fs.writeFileSync(
      entryLess,
      "@import (reference) '@demo/ui/shared/tokens.less';\n",
    );
    const loaded = await manager.loadFile(
      '@demo/ui/shared/tokens.less',
      appSrc,
      { filename: entryLess },
      {},
    );
    expect(loaded.filename).toBe(fs.realpathSync.native(sourceTokens));
    expect(loaded.contents).toContain('#dbeafe');
    // Only concrete entry .less — not Vite's `${dir}/*` pseudo importer.
    expect(trackImport).toHaveBeenCalledTimes(1);
    expect(trackImport).toHaveBeenCalledWith(
      fs.realpathSync.native(sourceTokens),
      path.resolve(entryLess),
    );

    trackImport.mockClear();
    await manager.loadFile('@demo/ui/shared/tokens.less', appSrc, {}, {});
    expect(trackImport).not.toHaveBeenCalled();
  });
});
