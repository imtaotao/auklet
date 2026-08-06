import fs from 'node:fs';
import path from 'node:path';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';

export const stripCssModuleQuery = (id: string) => id.split('?', 1)[0] ?? id;

export type ResolveCssModuleImportOptions = {
  source: string;
  importer?: string;
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
    (isCssModuleFile(cleanImporter) ? path.resolve(cleanImporter) : null);

  return moduleFile
    ? path.dirname(moduleFile)
    : path.dirname(path.resolve(cleanImporter));
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
    candidate = path.resolve(
      resolveImporterDirectory(options.importer, options.parseModuleFileFromId),
      cleanSource,
    );
  } else if (!path.isAbsolute(cleanSource)) {
    return null;
  }

  const file = path.resolve(candidate);
  if (!isCssModuleFile(file)) return null;
  if (options.requireExistingFile !== false && !fs.existsSync(file))
    return null;
  return file;
}
