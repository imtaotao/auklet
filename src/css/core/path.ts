import fs from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '#auklet/utils';

const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(file: string) {
  return WINDOWS_ABSOLUTE_PATH_RE.test(file);
}

export function normalizeCssFileKey(file: string) {
  if (process.platform !== 'win32' && isWindowsAbsolutePath(file)) {
    return toPosixPath(file);
  }

  const resolved = path.resolve(file);
  const realpath = fs.existsSync(resolved)
    ? fs.realpathSync.native(resolved)
    : resolved;

  return toPosixPath(realpath);
}

export function toCssFsSpecifier(file: string) {
  return path.posix.join('/@fs', normalizeCssFileKey(file));
}

export function toCssWatchPath(...parts: Array<string>) {
  if (parts[0] && isWindowsAbsolutePath(parts[0])) {
    return toPosixPath(path.win32.join(...parts));
  }

  return toPosixPath(path.join(...parts));
}
