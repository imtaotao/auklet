import fs from 'node:fs';
import path from 'node:path';
import { slash } from 'aidly';

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

export function fileWalker(dir: string): Array<string> {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && isTestDir(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...fileWalker(fullPath));
      continue;
    }

    if (isTestFile(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

export function toPosixPath(value: string) {
  return slash(value);
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
