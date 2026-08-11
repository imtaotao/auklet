import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { tryResolveExternalLessFile } from '#auklet/css/core/resolvers/externalLess';
import {
  clearSharedOutputResolveCache,
  setSharedOutputResolveCache,
} from '#auklet/css/core/style/sharedOutput';
import {
  collectViteLessImporterHotUpdateModules,
  filterSafeViteNativeHotUpdateModules,
  LessImportTracker,
} from '#auklet/css/vite/hmr/viteLessImport';
import { normalizeFileKey } from '#auklet/utils';

const tempDirs: Array<string> = [];

afterEach(() => {
  clearSharedOutputResolveCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const writeSharedTokensPackage = (options: {
  root: string;
  packageDir: string;
  packageName: string;
  exportSubpath?: string;
}) => {
  const exportSubpath = options.exportSubpath ?? './shared/tokens.less';
  const packageRoot = path.join(options.root, options.packageDir);
  const sourceTokens = path.join(packageRoot, 'src/shared/tokens.less');
  const distTokens = path.join(packageRoot, 'dist/es/shared/tokens.less');
  fs.mkdirSync(path.dirname(sourceTokens), { recursive: true });
  fs.mkdirSync(path.dirname(distTokens), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: options.packageName,
      exports: {
        [exportSubpath]: {
          less: './dist/es/shared/tokens.less',
          default: './dist/es/shared/tokens.less',
        },
      },
    }),
  );
  fs.writeFileSync(sourceTokens, `@brand: ${options.packageName};\n`);
  fs.writeFileSync(distTokens, '@brand: dist;\n');
  setSharedOutputResolveCache(packageRoot, {
    sourceRoot: path.join(packageRoot, 'src'),
    outputDir: 'dist',
    outputFormats: ['es', 'lib'],
    moduleFileKeys: new Set(),
    plainFileKeys: new Set([normalizeFileKey(sourceTokens)]),
  });
  return {
    packageRoot,
    sourceTokens: fs.realpathSync.native(sourceTokens),
  };
};

const linkAppDependency = (options: {
  root: string;
  packageName: string;
  packageRoot: string;
}) => {
  const appRoot = path.join(options.root, 'app');
  const scope = options.packageName.startsWith('@')
    ? options.packageName.split('/')[0]!
    : null;
  const linkParent = scope
    ? path.join(appRoot, 'node_modules', scope)
    : path.join(appRoot, 'node_modules');
  const linkName = scope
    ? options.packageName.slice(scope.length + 1)
    : options.packageName;
  fs.mkdirSync(linkParent, { recursive: true });
  const linkPath = path.join(linkParent, linkName);
  if (!fs.existsSync(linkPath)) {
    fs.symlinkSync(options.packageRoot, linkPath, 'dir');
  }
};

describe('viteLessImport HMR helpers', () => {
  test('tracks concrete entry .less importers and ignores dir/*', () => {
    const tracker = new LessImportTracker();
    const resolved = path.resolve('/tmp/ui/src/shared/tokens.less');
    const dir = path.resolve('/tmp/app/src');
    const absImporter = path.join(dir, 'tokens-demo.less');
    tracker.track(resolved, path.join(dir, '*'));
    tracker.track(resolved, absImporter);
    expect(tracker.listTrackIds(resolved)).toEqual([absImporter]);

    const importerModule = {
      id: absImporter,
      file: absImporter,
    };
    const modules = collectViteLessImporterHotUpdateModules({
      tracker,
      file: resolved,
      moduleGraph: {
        getModuleById: (id: string) =>
          id === absImporter ? (importerModule as never) : undefined,
        idToModuleMap: new Map([[importerModule.id, importerModule as never]]),
      } as never,
    });
    expect(modules).toEqual([importerModule]);
  });

  test('pruneStale drops importers that left the module graph', () => {
    const tracker = new LessImportTracker();
    const resolved = path.resolve('/tmp/ui/src/shared/tokens.less');
    const live = path.resolve('/tmp/app/src/tokens-demo.less');
    const gone = path.resolve('/tmp/app/src/gone.less');
    tracker.track(resolved, live);
    tracker.track(resolved, gone);

    const liveModule = { id: live, file: live };
    tracker.pruneStale({
      getModuleById: (id: string) =>
        id === live ? (liveModule as never) : undefined,
    } as never);

    expect(tracker.listTrackIds(resolved)).toEqual([live]);
  });

  test('source-scan finds package @import importers without prior track', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auklet-less-scan-'));
    tempDirs.push(root);
    const ui = writeSharedTokensPackage({
      root,
      packageDir: 'packages/ui',
      packageName: '@demo/ui',
    });
    const appSrc = path.join(root, 'app/src');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'app/package.json'),
      JSON.stringify({
        name: '@demo/app',
        dependencies: { '@demo/ui': 'workspace:*' },
      }),
    );
    linkAppDependency({
      root,
      packageName: '@demo/ui',
      packageRoot: ui.packageRoot,
    });

    const absImporter = path.join(appSrc, 'tokens-demo.less');
    fs.writeFileSync(
      absImporter,
      `@import (reference) '@demo/ui/shared/tokens.less';\n.token-demo { color: red; }\n`,
    );
    const importerModule = {
      id: absImporter,
      file: absImporter,
      url: '/src/tokens-demo.less',
    };

    const modules = collectViteLessImporterHotUpdateModules({
      tracker: new LessImportTracker(),
      file: ui.sourceTokens,
      moduleGraph: {
        getModuleById: () => undefined,
        idToModuleMap: new Map([[importerModule.id, importerModule as never]]),
      } as never,
    });
    expect(modules).toEqual([importerModule]);
  });

  test('source-scan resolves browser url modules via vite root hint', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auklet-less-url-'));
    tempDirs.push(root);
    const ui = writeSharedTokensPackage({
      root,
      packageDir: 'packages/ui',
      packageName: '@demo/ui',
    });
    const appSrc = path.join(root, 'app/src');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'app/package.json'),
      JSON.stringify({
        name: '@demo/app',
        dependencies: { '@demo/ui': 'workspace:*' },
      }),
    );
    linkAppDependency({
      root,
      packageName: '@demo/ui',
      packageRoot: ui.packageRoot,
    });

    const absImporter = path.join(appSrc, 'tokens-demo.less');
    const hintFile = path.join(appSrc, 'hint.less');
    fs.writeFileSync(
      absImporter,
      `@import (reference) '@demo/ui/shared/tokens.less';\n.token-demo { color: red; }\n`,
    );
    fs.writeFileSync(hintFile, '.hint {}\n');

    const hintModule = {
      id: hintFile,
      file: hintFile,
      url: '/src/hint.less',
    };
    const importerModule = {
      id: '/src/tokens-demo.less',
      url: '/src/tokens-demo.less',
      file: null as string | null,
    };

    const modules = collectViteLessImporterHotUpdateModules({
      tracker: new LessImportTracker(),
      file: ui.sourceTokens,
      moduleGraph: {
        getModuleById: () => undefined,
        idToModuleMap: new Map([
          [hintModule.id, hintModule as never],
          [importerModule.id, importerModule as never],
        ]),
      } as never,
    });
    expect(modules).toEqual([importerModule]);
  });

  test('source-scan does not match same-named tokens.less from another package', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'auklet-less-scan-dup-'),
    );
    tempDirs.push(root);
    const uiA = writeSharedTokensPackage({
      root,
      packageDir: 'packages/ui-a',
      packageName: '@demo/ui-a',
    });
    const uiB = writeSharedTokensPackage({
      root,
      packageDir: 'packages/ui-b',
      packageName: '@demo/ui-b',
    });
    const appSrc = path.join(root, 'app/src');
    fs.mkdirSync(appSrc, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'app/package.json'),
      JSON.stringify({
        name: '@demo/app',
        dependencies: {
          '@demo/ui-a': 'workspace:*',
          '@demo/ui-b': 'workspace:*',
        },
      }),
    );
    linkAppDependency({
      root,
      packageName: '@demo/ui-a',
      packageRoot: uiA.packageRoot,
    });
    linkAppDependency({
      root,
      packageName: '@demo/ui-b',
      packageRoot: uiB.packageRoot,
    });

    const absImporter = path.join(appSrc, 'tokens-demo.less');
    fs.writeFileSync(
      absImporter,
      `@import (reference) '@demo/ui-b/shared/tokens.less';\n.token-demo { color: red; }\n`,
    );
    const importerModule = {
      id: absImporter,
      file: absImporter,
      url: '/src/tokens-demo.less',
    };
    const moduleGraph = {
      getModuleById: () => undefined,
      idToModuleMap: new Map([[importerModule.id, importerModule as never]]),
    } as never;
    const tracker = new LessImportTracker();
    expect(
      tryResolveExternalLessFile('@demo/ui-b/shared/tokens.less', appSrc),
    ).toBe(uiB.sourceTokens);
    expect(
      tryResolveExternalLessFile('@demo/ui-a/shared/tokens.less', appSrc),
    ).toBe(uiA.sourceTokens);

    expect(
      collectViteLessImporterHotUpdateModules({
        tracker,
        file: uiA.sourceTokens,
        moduleGraph,
      }),
    ).toEqual([]);

    expect(
      collectViteLessImporterHotUpdateModules({
        tracker,
        file: uiB.sourceTokens,
        moduleGraph,
      }),
    ).toEqual([importerModule]);
  });

  test('filterSafeViteNativeHotUpdateModules drops the changed partial', () => {
    const file = path.resolve('/tmp/ui/src/shared/tokens.less');
    const partial = { id: file, file };
    const other = {
      id: path.resolve('/tmp/app/src/tokens-demo.less'),
      file: path.resolve('/tmp/app/src/tokens-demo.less'),
    };

    expect(
      filterSafeViteNativeHotUpdateModules({
        file,
        modules: [partial as never, other as never],
      }),
    ).toEqual([other]);
  });
});
