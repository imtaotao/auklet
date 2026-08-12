import fs from 'node:fs';
import path from 'node:path';
import {
  findPackageRootForFile,
  isExternalPackageSpecifier,
} from '#auklet/css/core/resolvers/externalLess';
import {
  isCssModuleSpecifier,
  resolveExternalPackageStyleImport,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';

export const stripCssModuleQuery = (id: string) => id.split('?', 1)[0] ?? id;

export type ResolveCssModuleImportOptions = {
  source: string;
  importer?: string;
  importerPackageRoot?: string;
  parseModuleFileFromId?: (id: string) => string | null;
  requireExistingFile?: boolean;
};

const resolveImporterDirectory = (
  importer: string,
  parseModuleFileFromId?: (id: string) => string | null,
) => {
  const cleanImporter = stripCssModuleQuery(importer);
  const moduleFile =
    parseModuleFileFromId?.(cleanImporter) ??
    (isCssModuleFile(cleanImporter) && !cleanImporter.includes('\0')
      ? path.resolve(cleanImporter)
      : null);

  if (moduleFile) return path.dirname(moduleFile);
  // Foreign Vite virtual importers (`\0…`) are not filesystem paths.
  if (cleanImporter.includes('\0')) return null;
  return path.dirname(path.resolve(cleanImporter));
};

const resolveImporterPackageRoot = (
  importer: string | undefined,
  importerPackageRoot: string | undefined,
  parseModuleFileFromId?: (id: string) => string | null,
) => {
  if (importerPackageRoot) return path.resolve(importerPackageRoot);
  if (!importer) return null;
  const cleanImporter = stripCssModuleQuery(importer);
  const moduleFile =
    parseModuleFileFromId?.(cleanImporter) ??
    (isCssModuleFile(cleanImporter) && !cleanImporter.includes('\0')
      ? path.resolve(cleanImporter)
      : null);
  if (moduleFile) return findPackageRootForFile(moduleFile);
  if (cleanImporter.includes('\0')) return null;
  return findPackageRootForFile(path.resolve(cleanImporter));
};

export function resolveCssModuleImport(options: ResolveCssModuleImportOptions) {
  const cleanSource = stripCssModuleQuery(options.source);
  if (cleanSource.startsWith('\0')) return null;

  const fromId = options.parseModuleFileFromId?.(cleanSource);
  if (fromId) {
    return path.resolve(fromId);
  }

  let candidate = cleanSource;
  if (cleanSource.startsWith('.')) {
    if (!options.importer) return null;
    const importerDirectory = resolveImporterDirectory(
      options.importer,
      options.parseModuleFileFromId,
    );
    if (!importerDirectory) return null;
    candidate = path.resolve(importerDirectory, cleanSource);
  } else if (path.isAbsolute(cleanSource)) {
    candidate = cleanSource;
  } else if (
    isExternalPackageSpecifier(cleanSource) &&
    isCssModuleSpecifier(cleanSource)
  ) {
    const importerPackageRoot = resolveImporterPackageRoot(
      options.importer,
      options.importerPackageRoot,
      options.parseModuleFileFromId,
    );
    if (!importerPackageRoot) return null;
    try {
      const resolved = resolveExternalPackageStyleImport(
        cleanSource,
        importerPackageRoot,
        {
          extensions: [
            '.module.css',
            '.module.less',
            '.module.css.js',
            '.module.less.js',
          ],
        },
      ).file;
      // Compiled shared.output shims are plain JS; let the bundler load them.
      if (/\.module\.(?:css|less)\.js$/i.test(resolved)) return null;
      return resolved;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const file = path.resolve(candidate);
  if (!isCssModuleFile(file)) return null;
  if (options.requireExistingFile !== false && !fs.existsSync(file)) {
    return null;
  }
  return file;
}
