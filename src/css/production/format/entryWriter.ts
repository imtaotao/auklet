import fs from 'node:fs';
import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { createStyleEntryParts } from '#auklet/css/core/style/plan';
import {
  type FormatWriterOptions,
  toRelativeImportSpecifier,
} from '#auklet/css/production/format/shared';
import type { ModuleStyleBuildConfig } from '#auklet/types';

export class StyleEntryWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly packageContext: StylePackageContext;
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.packageContext = options.packageContext;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  write(
    outRoot: string,
    themeStyles: Map<string, string>,
    moduleStyle: string | null,
  ) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.indexStyleFile,
    );
    const root = this.styleProcessor.createRoot();
    const styleDir = path.dirname(target);

    for (const part of createStyleEntryParts(
      this.packageContext.normalizedConfig,
    )) {
      if (part.type === 'dependencies') {
        for (const specifier of part.specifiers) {
          this.styleProcessor.appendImportRule(root, specifier);
        }
        continue;
      }

      if (part.type === 'themes') {
        for (const themeName of part.themeNames) {
          const themeStyle = themeStyles.get(themeName);
          if (!themeStyle) continue;
          this.styleProcessor.appendImportRule(
            root,
            toRelativeImportSpecifier(styleDir, themeStyle),
          );
        }
        continue;
      }

      if (moduleStyle) {
        this.styleProcessor.appendImportRule(
          root,
          toRelativeImportSpecifier(styleDir, moduleStyle),
        );
      }
    }

    if (!root.nodes?.length) return null;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, this.styleProcessor.stringify(root));
    return target;
  }
}
