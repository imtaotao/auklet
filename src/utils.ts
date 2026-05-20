import fs from 'node:fs';
import path from 'node:path';
import { slash } from 'aidly';

const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;

export const POSIX_SEPARATOR = '/';
export const IMPORT_LIST_SEPARATOR = ',';

export const TEST_DIR_NAMES = new Set([
  '__test__',
  '__tests__',
  'test',
  'tests',
]);
export const SOURCE_TEST_RE = /\.(spec|test)\.[cm]?(ts|tsx|js|jsx)$/;
export const SOURCE_MODULE_RE = /\.(ts|tsx)$/;
export const SOURCE_DECLARATION_RE = /\.d\.[cm]?ts$/;
export const TYPE_IMPORT_PREFIX = /^type\s+/;
export const IMPORT_ALIAS_SEPARATOR = /\s+as\s+/;

export function isTestDir(name: string) {
  return TEST_DIR_NAMES.has(name);
}

export function isTestFile(name: string) {
  return SOURCE_TEST_RE.test(name);
}

export function fileWalker(dir: string) {
  const files: Array<string> = [];

  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && isTestDir(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (isTestFile(entry.name)) continue;
      files.push(fullPath);
    }
  };

  walk(dir);
  return files;
}

export function toPosixPath(value: string) {
  return slash(value);
}

export function isWindowsAbsolutePath(file: string) {
  return WINDOWS_ABSOLUTE_PATH_RE.test(file);
}

export function normalizeFileKey(file: string) {
  if (process.platform !== 'win32' && isWindowsAbsolutePath(file)) {
    return toPosixPath(file);
  }

  const resolved = path.resolve(file);
  const realpath = fs.existsSync(resolved)
    ? fs.realpathSync.native(resolved)
    : resolved;

  return toPosixPath(realpath);
}

export function toFsSpecifier(file: string) {
  return path.posix.join('/@fs', normalizeFileKey(file));
}

export function toWatchPath(...parts: Array<string>) {
  if (parts[0] && isWindowsAbsolutePath(parts[0])) {
    return toPosixPath(path.win32.join(...parts));
  }

  return toPosixPath(path.join(...parts));
}

export function removeExtension(file: string) {
  return file.slice(0, -path.extname(file).length);
}

export function getSourceModuleDir(file: string) {
  const filename = path.basename(file);
  if (filename.startsWith('index.')) {
    return path.dirname(file);
  }
  return removeExtension(file);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function appendUniqueMapValue<K, V>(
  map: Map<K, Array<V>>,
  key: K,
  value: V,
) {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}
