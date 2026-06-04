import path from 'node:path';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { groupStyleFilesByDir } from '#auklet/css/core/style/files';
import { getSourceModuleDir, toPosixPath } from '#auklet/utils';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';

export type ModuleStyleEntryPlan = {
  sourceDir: string;
  ownStyleFiles: Array<string>;
  moduleStyleImports: Array<string>;
};

export class StyleModuleEntryPlanner {
  private readonly importedStyleFiles: Set<string>;
  private readonly styleFilesByDir: Map<string, Array<string>>;

  constructor(private readonly packageContext: StylePackageContext) {
    this.styleFilesByDir = groupStyleFilesByDir(
      this.packageContext.sourceRoot,
      this.packageContext.styleFiles,
    );
    this.importedStyleFiles =
      this.packageContext.styleProcessor.collectImportedStyleFiles(
        this.packageContext.styleFiles,
      );
    this.rejectCrossModuleStyleImports();
  }

  createEntries(moduleStyleImports: Map<string, Array<string>>) {
    return this.getSourceDirs(moduleStyleImports).map((sourceDir) =>
      this.createEntry(sourceDir, moduleStyleImports),
    );
  }

  createEntry(
    sourceDir: string,
    moduleStyleImports: Map<string, Array<string>>,
  ) {
    return {
      sourceDir,
      moduleStyleImports: moduleStyleImports.get(sourceDir) ?? [],
      ownStyleFiles: this.getOwnStyleFiles(sourceDir),
    } satisfies ModuleStyleEntryPlan;
  }

  private getSourceDirs(moduleStyleImports: Map<string, Array<string>>) {
    return Array.from(
      new Set([
        ...this.getSourceModuleDirs(),
        ...this.getOwnStyleDirs(),
        ...moduleStyleImports.keys(),
      ]),
    ).filter((sourceDir) => sourceDir !== '.');
  }

  private getSourceModuleDirs() {
    return this.packageContext.sourceFiles
      .filter((sourceFile) => SOURCE_MODULE_RE.test(sourceFile))
      .map((sourceFile) => {
        return getSourceModuleDir(
          path.relative(this.packageContext.sourceRoot, sourceFile),
        );
      })
      .filter((sourceModuleDir) => {
        return toPosixPath(sourceModuleDir).split('/').length === 2;
      });
  }

  private getOwnStyleDirs() {
    return Array.from(this.styleFilesByDir.entries())
      .filter(([, dirStyleFiles]) =>
        dirStyleFiles.some(
          (styleFile) => !this.importedStyleFiles.has(path.resolve(styleFile)),
        ),
      )
      .map(([sourceDir]) => sourceDir);
  }

  private getOwnStyleFiles(sourceDir: string) {
    return (this.styleFilesByDir.get(sourceDir) ?? []).filter(
      (styleFile) => !this.importedStyleFiles.has(path.resolve(styleFile)),
    );
  }

  private rejectCrossModuleStyleImports() {
    if (!this.packageContext.normalizedConfig.modules) return;

    const styleFileKeys = new Set(
      this.packageContext.styleFiles.map((file) => path.resolve(file)),
    );
    const imports =
      this.packageContext.styleProcessor.collectImportedStyleFileReferences(
        this.packageContext.styleFiles,
      );

    for (const item of imports) {
      if (!styleFileKeys.has(item.imported)) continue;

      const importerModuleDir = this.getStyleFileModuleDir(item.importer);
      const importedModuleDir = this.getStyleFileModuleDir(item.imported);

      if (
        !importerModuleDir ||
        !importedModuleDir ||
        importerModuleDir === importedModuleDir
      ) {
        continue;
      }

      const importer = this.toRelativeSourceFile(item.importer);
      const imported = this.toRelativeSourceFile(item.imported);
      throw new Error(
        `[css] cross-component CSS import detected: ${importer} imports ${imported}. ` +
          'Use TSX imports to express component dependencies so auklet can ' +
          'generate module CSS entries correctly.',
      );
    }
  }

  private getStyleFileModuleDir(file: string) {
    const sourceRelative = toPosixPath(
      path.relative(this.packageContext.sourceRoot, file),
    );
    const parts = sourceRelative.split('/');
    if (parts.length < 2) return null;
    if (parts.length === 2) return getSourceModuleDir(sourceRelative);
    return parts.slice(0, 2).join('/');
  }

  private toRelativeSourceFile(file: string) {
    return toPosixPath(path.relative(this.packageContext.sourceRoot, file));
  }
}
