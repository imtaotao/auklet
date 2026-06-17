import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PackageStyleLoadResult } from '#auklet/css/vite/moduleGraph/types';
import { toPosixPath } from '#auklet/utils';

type CachedFile =
  | {
      hash: string;
      file: string;
      exists: true;
      realpath: string;
      type: 'file';
      mtimeMs: number;
      size: number;
    }
  | {
      file: string;
      exists: true;
      realpath: string;
      type: 'directory';
      mtimeMs: number;
      size: number;
    }
  | {
      file: string;
      exists: false;
    };

type CachedStyleLoadResult = {
  files: Array<CachedFile>;
  key: string;
  result: PackageStyleLoadResult;
};

export type PersistentStyleGraphCacheOptions = {
  root: string;
};

const cacheVersion = 'v1';

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashValue = (value: unknown) => {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
};

const hashFile = (file: string) => {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
};

const normalizeCachePath = (file: string) => {
  return toPosixPath(path.resolve(file));
};

const normalizeRealpath = (file: string) => {
  return toPosixPath(fs.realpathSync.native(file));
};

const statCachedFile = (file: string) => {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return {
      file: normalizeCachePath(file),
      exists: false,
    } satisfies CachedFile;
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return {
      file: normalizeCachePath(file),
      exists: true,
      realpath: normalizeRealpath(resolved),
      type: 'directory',
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    } satisfies CachedFile;
  }
  if (!stat.isFile()) {
    return {
      file: normalizeCachePath(file),
      exists: false,
    } satisfies CachedFile;
  }
  return {
    hash: hashFile(resolved),
    file: normalizeCachePath(file),
    exists: true,
    realpath: normalizeRealpath(resolved),
    type: 'file',
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  } satisfies CachedFile;
};

export class PersistentStyleGraphCache {
  private readonly cacheRoot: string;

  constructor(options: PersistentStyleGraphCacheOptions) {
    this.cacheRoot = path.join(
      options.root,
      'node_modules',
      '.auklet',
      'cache',
      'vite-style',
      cacheVersion,
    );
  }

  createKey(value: unknown) {
    return hashValue({
      cacheVersion,
      value,
    });
  }

  read(key: string) {
    const cacheFile = this.getCacheFile(key);
    if (!fs.existsSync(cacheFile)) return null;

    try {
      const cached = JSON.parse(
        fs.readFileSync(cacheFile, 'utf8'),
      ) as CachedStyleLoadResult;
      if (cached.key !== key) return null;
      if (!this.isFresh(cached.files)) return null;
      return cached.result;
    } catch {
      return null;
    }
  }

  write(
    key: string,
    result: PackageStyleLoadResult,
    inputFiles: Array<string>,
  ) {
    const files = Array.from(
      new Map(
        inputFiles
          .map((file) => statCachedFile(file))
          .map((file) => [file.file, file]),
      ).values(),
    );

    try {
      fs.mkdirSync(this.cacheRoot, { recursive: true });
      fs.writeFileSync(
        this.getCacheFile(key),
        `${JSON.stringify(
          {
            files,
            key,
            result,
          } satisfies CachedStyleLoadResult,
          null,
          2,
        )}\n`,
      );
    } catch {
      // Cache writes are an optimization; dev CSS generation must keep working.
    }
  }

  private getCacheFile(key: string) {
    return path.join(this.cacheRoot, `${key}.json`);
  }

  private isFresh(files: Array<CachedFile>) {
    for (const file of files) {
      const current = statCachedFile(file.file);
      if (current.exists !== file.exists) return false;
      if (!current.exists || !file.exists) continue;
      if (current.type !== file.type) return false;
      if (
        current.realpath !== file.realpath ||
        current.size !== file.size ||
        current.mtimeMs !== file.mtimeMs ||
        toPosixPath(current.file) !== toPosixPath(file.file)
      ) {
        return false;
      }
      if (
        current.type === 'file' &&
        file.type === 'file' &&
        current.hash !== file.hash
      ) {
        return false;
      }
    }
    return true;
  }
}
