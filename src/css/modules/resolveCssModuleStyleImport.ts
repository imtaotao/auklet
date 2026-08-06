import path from 'node:path';
import { resolveLocalStyleImport } from '#auklet/css/core/lessImportGraph';

const isInsideSourceRoot = (file: string, sourceRoot: string) => {
  const relative = path.relative(sourceRoot, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const resolveCssModuleStyleImport = (
  specifier: string,
  importerFile: string,
  options?: { sourceRoot?: string; allowMissing?: boolean },
) => {
  if (!specifier.startsWith('.')) {
    throw new Error(
      `[css] CSS Modules partial imports must be relative paths: ${specifier} from ${importerFile}`,
    );
  }

  const importedPath = resolveLocalStyleImport(
    specifier,
    path.dirname(importerFile),
  );
  if (!importedPath) {
    if (options?.allowMissing) {
      const unresolvedPath = path.resolve(
        path.dirname(importerFile),
        specifier,
      );
      if (
        options.sourceRoot &&
        !isInsideSourceRoot(unresolvedPath, options.sourceRoot)
      ) {
        throw new Error(
          `[css] local CSS import escapes source root: ${specifier} from ${importerFile}`,
        );
      }
      return null;
    }
    throw new Error(
      `[css] local CSS import not found: ${specifier} from ${importerFile}`,
    );
  }

  if (
    options?.sourceRoot &&
    !isInsideSourceRoot(importedPath, options.sourceRoot)
  ) {
    throw new Error(
      `[css] local CSS import escapes source root: ${specifier} from ${importerFile}`,
    );
  }

  return importedPath;
};

export const assertLessCompileImportsWithinSourceRoot = (
  imports: Array<string>,
  importerFile: string,
  sourceRoot?: string,
) => {
  if (!sourceRoot) return;

  for (const imported of imports) {
    if (isInsideSourceRoot(imported, sourceRoot)) continue;

    const relative = path.relative(path.dirname(importerFile), imported);
    const specifier = relative.startsWith('.') ? relative : `./${relative}`;
    throw new Error(
      `[css] local CSS import escapes source root: ${specifier} from ${importerFile}`,
    );
  }
};
