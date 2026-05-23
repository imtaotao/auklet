import path from 'node:path';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { groupStyleFilesByDir } from '#auklet/css/core/style/files';
import { getSourceModuleDir, toPosixPath } from '#auklet/utils';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';

export type ModuleStyleEntryPlan = {
  sourceDir: string;
  moduleStyleImports: Array<string>;
  ownStyleFiles: Array<string>;
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
}
