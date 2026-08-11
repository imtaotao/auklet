import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  findPackageRootForFile,
  readPackageName,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import { toPosixPath } from '#auklet/utils';

const MODULE_SUFFIX_RE = /\.module\.(css|less)$/i;

export type GenerateScopedNameOptions = {
  packageName?: string | null;
  packageRoot?: string | null;
  sourceRoot?: string | null;
};

// Relative path keys must stay relative. Do not normalizeFileKey them — that
// resolves against cwd and breaks build-vs-test / cross-package hash parity.
const resolveScopedPathKey = (
  filename: string,
  options: GenerateScopedNameOptions,
) => {
  const absolute = path.resolve(filename);
  const packageRoot =
    options.packageRoot != null
      ? path.resolve(options.packageRoot)
      : findPackageRootForFile(absolute);
  const packageName =
    options.packageName ??
    (packageRoot ? readPackageName(packageRoot) : null) ??
    'package';
  const root = options.sourceRoot
    ? path.resolve(options.sourceRoot)
    : packageRoot
      ? path.resolve(packageRoot)
      : path.dirname(absolute);
  const relative = toPosixPath(path.relative(root, absolute));
  const pathKey =
    !relative || relative.startsWith('..') || path.isAbsolute(relative)
      ? toPosixPath(path.basename(absolute))
      : relative;

  return {
    packageName,
    pathKey,
  };
};

export function createGenerateScopedName(
  options: GenerateScopedNameOptions = {},
) {
  return (localName: string, filename: string, _css: string) => {
    const { packageName, pathKey } = resolveScopedPathKey(filename, options);
    const base = path.basename(filename).replace(MODULE_SUFFIX_RE, '');
    const hash = createHash('sha256')
      .update(`${packageName}:${pathKey}:${localName}`)
      .digest('base64url')
      .slice(0, 6);

    return `${base}_${localName}_${hash}`;
  };
}

export function generateScopedName(
  localName: string,
  filename: string,
  css: string,
) {
  return createGenerateScopedName()(localName, filename, css);
}
