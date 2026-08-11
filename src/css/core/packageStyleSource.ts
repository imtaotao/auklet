import fs from 'node:fs';
import path from 'node:path';
import { compileLess } from '#auklet/css/core/lessCompiler';
import {
  ExternalLessResolutionError,
  isExternalPackageSpecifier,
} from '#auklet/css/core/resolvers/externalLess';
import {
  isPlainStyleSpecifier,
  resolveExternalPackageStyleImport,
} from '#auklet/css/core/resolvers/externalPackageStyle';

// Shared by build `packageStyleImportPlugin` and Vite package-style resolve/load
// so resolve gates and Less→CSS text stay aligned.
export const PLAIN_PACKAGE_STYLE_EXTENSIONS = ['.css', '.less'] as const;

export function resolvePlainPackageStyleFile(
  source: string,
  importerPackageRoot: string,
) {
  if (!isExternalPackageSpecifier(source) || !isPlainStyleSpecifier(source)) {
    return null;
  }
  try {
    return resolveExternalPackageStyleImport(source, importerPackageRoot, {
      extensions: [...PLAIN_PACKAGE_STYLE_EXTENSIONS],
    }).file;
  } catch (error) {
    if (error instanceof ExternalLessResolutionError) {
      throw error;
    }
    return null;
  }
}

export async function loadPackageStyleCss(file: string) {
  const source = fs.readFileSync(file, 'utf8');
  if (path.extname(file).toLowerCase() === '.less') {
    return (await compileLess(file, source)).css;
  }
  return source;
}
