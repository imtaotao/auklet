import fs from 'node:fs';
import path from 'node:path';
import {
  compileCssModule,
  type CssModuleResult,
} from '#auklet/css/modules/compileCssModule';
import { normalizeFileKey } from '#auklet/utils';

type CssModuleCompileCacheEntry = {
  result: CssModuleResult;
  watchSnapshot: Map<string, number>;
};

export type CssModuleDevCompileOptions = {
  sourceRoot?: string;
  force?: boolean;
  read?: () => string | Promise<string>;
};

export function sameCssModuleLocals(
  previous: Record<string, string>,
  next: Record<string, string>,
) {
  const previousKeys = Object.keys(previous).sort();
  const nextKeys = Object.keys(next).sort();
  if (previousKeys.length !== nextKeys.length) return false;
  for (let index = 0; index < previousKeys.length; index += 1) {
    const key = previousKeys[index]!;
    if (key !== nextKeys[index]) return false;
    if (previous[key] !== next[key]) return false;
  }
  return true;
}

export class CssModuleDevCompileCache {
  private readonly entries = new Map<string, CssModuleCompileCacheEntry>();
  private readonly inFlight = new Map<string, Promise<CssModuleResult>>();
  private readonly generations = new Map<string, number>();

  peekLocals(file: string) {
    return this.entries.get(this.toKey(file))?.result.locals ?? null;
  }

  invalidateModuleFile(file: string) {
    const key = this.toKey(file);
    this.entries.delete(key);
    this.inFlight.delete(key);
    this.bumpGeneration(key);
  }

  invalidateWatchFile(file: string) {
    const normalized = this.toKey(file);
    for (const [entryKey, entry] of this.entries) {
      for (const watchedFile of entry.watchSnapshot.keys()) {
        if (this.toKey(watchedFile) === normalized) {
          this.entries.delete(entryKey);
          this.inFlight.delete(entryKey);
          this.bumpGeneration(entryKey);
          break;
        }
      }
    }
  }

  async compile(
    file: string,
    options: CssModuleDevCompileOptions = {},
  ): Promise<CssModuleResult> {
    const key = this.toKey(file);
    const cached = this.entries.get(key);
    if (!options.force && cached && !this.isStale(cached) && !options.read) {
      return cached.result;
    }

    if (options.force) {
      this.bumpGeneration(key);
    } else {
      const pending = this.inFlight.get(key);
      if (pending) {
        return pending;
      }
    }

    const generation = this.getGeneration(key);
    let compilePromise!: Promise<CssModuleResult>;
    compilePromise = this.runCompile(
      key,
      options,
      generation,
      () => compilePromise,
    );
    this.inFlight.set(key, compilePromise);

    try {
      return await compilePromise;
    } finally {
      if (this.inFlight.get(key) === compilePromise) {
        this.inFlight.delete(key);
      }
    }
  }

  private bumpGeneration(key: string) {
    this.generations.set(key, this.getGeneration(key) + 1);
  }

  private getGeneration(key: string) {
    return this.generations.get(key) ?? 0;
  }

  private async runCompile(
    key: string,
    options: CssModuleDevCompileOptions,
    generation: number,
    getSelf: () => Promise<CssModuleResult>,
  ) {
    const readResult = options.read ? await options.read() : undefined;
    const result = await compileCssModule({
      file: key,
      sourceRoot: options.sourceRoot,
      code: readResult,
    });
    if (this.getGeneration(key) === generation) {
      this.entries.set(key, {
        result,
        watchSnapshot: this.snapshotWatchFiles(result.watchFiles),
      });
      return result;
    }
    return this.resolveFreshResult(key, options, getSelf());
  }

  private async resolveFreshResult(
    key: string,
    options: CssModuleDevCompileOptions,
    self?: Promise<CssModuleResult>,
  ) {
    const cached = this.entries.get(key);
    if (cached) {
      return cached.result;
    }

    const pending = this.inFlight.get(key);
    if (pending && pending !== self) {
      return pending;
    }

    return this.compile(key, {
      sourceRoot: options.sourceRoot,
    });
  }

  private toKey(file: string) {
    return normalizeFileKey(path.resolve(file));
  }

  private snapshotWatchFiles(files: Iterable<string>) {
    const snapshot = new Map<string, number>();
    for (const file of files) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) continue;
      snapshot.set(resolved, fs.statSync(resolved).mtimeMs);
    }
    return snapshot;
  }

  private isStale(entry: CssModuleCompileCacheEntry) {
    for (const [file, mtime] of entry.watchSnapshot) {
      if (!fs.existsSync(file)) return true;
      if (fs.statSync(file).mtimeMs !== mtime) return true;
    }
    return false;
  }
}

export class CssModuleDevCompileCacheRegistry {
  private readonly caches = new Map<string, CssModuleDevCompileCache>();

  forEnvironment(environment: string) {
    let cache = this.caches.get(environment);
    if (!cache) {
      cache = new CssModuleDevCompileCache();
      this.caches.set(environment, cache);
    }
    return cache;
  }

  invalidateModuleFile(file: string) {
    for (const cache of this.caches.values()) {
      cache.invalidateModuleFile(file);
    }
  }

  invalidateWatchFile(file: string) {
    for (const cache of this.caches.values()) {
      cache.invalidateWatchFile(file);
    }
  }
}
