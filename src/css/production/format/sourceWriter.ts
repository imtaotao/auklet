import path from 'node:path';
import {
  type FormatWriterOptions,
  toRelativeImportSpecifier,
  writeStyleFile,
} from '#auklet/css/production/format/shared';
import { toOutputStylePath } from '#auklet/css/core/style/specifier';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';

export class SourceStyleFileWriter {
  private readonly sourceRoot: string;
  private readonly resolver: StylePackageContext['resolver'];
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.sourceRoot = options.packageContext.sourceRoot;
    this.resolver = options.packageContext.resolver;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  async copy(files: Array<string>, outRoot: string) {
    for (const sourceFile of files) {
      const relative = toOutputStylePath(
        path.relative(this.sourceRoot, sourceFile),
      );
      const target = path.join(outRoot, relative);
      const content = await this.styleProcessor.readStyleFile(
        sourceFile,
        undefined,
        {
          applyPrefix: true,
          mapImportSpecifier: (reference) => {
            if (!this.resolver.isInsideSourceRoot(reference.imported)) {
              return reference.specifier;
            }
            return toRelativeImportSpecifier(
              path.dirname(target),
              path.join(
                outRoot,
                toOutputStylePath(
                  path.relative(this.sourceRoot, reference.imported),
                ),
              ),
            );
          },
          shouldExpandImport: () => false,
        },
      );
      writeStyleFile(target, content);
    }
  }
}
