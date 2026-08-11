import fs from 'node:fs';
import path from 'node:path';
import less from 'less';
import { tryResolveExternalLessFile } from '#auklet/css/core/resolvers/externalLess';

type TrackViteLessImport = (resolvedFile: string, importer: string) => void;

// Tried before Vite's built-in Less FileManager (Less walks managers last-first).
// Vite's less IdResolver does not run user resolveId plugins, so workspace
// shared.output remap for `@import (reference) 'pkg/…less'` must happen here
// via tryResolveExternalLessFile → resolveExternalLessImport (same path as
// production external Less: exports → published file, then workspace remap to
// source when sharedOutputResolveCache is warm; installed packages stay on
// published artifacts).
class AukletViteLessFileManager extends less.FileManager {
  constructor(private readonly trackImport: TrackViteLessImport) {
    super();
  }

  supports(filename: string, currentDirectory: string) {
    return tryResolveExternalLessFile(filename, currentDirectory) != null;
  }

  supportsSync(filename: string, currentDirectory: string) {
    return this.supports(filename, currentDirectory);
  }

  // Less FileManager typings vary by version; keep runtime args and read
  // optional filename for HMR tracking.
  async loadFile(
    filename: string,
    currentDirectory: string,
    options: never,
    _environment: never,
  ) {
    const resolved = tryResolveExternalLessFile(filename, currentDirectory);
    if (!resolved) {
      throw new Error(
        `external Less import could not be resolved: ${filename}`,
      );
    }
    // HMR: only concrete entry `.less` (options.filename). Vite's `${dir}/*`
    // importer shape is not tracked — hotUpdate uses source-scan when needed.
    const optionsRecord = options as { filename?: string } | null | undefined;
    const ownerFile =
      typeof optionsRecord?.filename === 'string'
        ? optionsRecord.filename.split('?', 1)[0]
        : null;
    if (ownerFile && /\.less$/i.test(ownerFile) && fs.existsSync(ownerFile)) {
      this.trackImport(resolved, path.resolve(ownerFile));
    }
    return {
      filename: resolved,
      contents: fs.readFileSync(resolved, 'utf8'),
    };
  }
}

export function createAukletViteLessPlugin(options: {
  trackImport: TrackViteLessImport;
}) {
  return {
    install(
      _less: typeof less,
      pluginManager: {
        addFileManager(fileManager: AukletViteLessFileManager): void;
      },
    ) {
      pluginManager.addFileManager(
        new AukletViteLessFileManager(options.trackImport),
      );
    },
    minVersion: [3, 0, 0] as [number, number, number],
  };
}
