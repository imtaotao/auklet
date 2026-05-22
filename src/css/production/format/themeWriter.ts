import fs from 'node:fs';
import path from 'node:path';
import { THEMES_DIR } from '#auklet/css/constants';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { createThemeEntryParts } from '#auklet/css/core/style/entries';
import {
  type FormatWriterOptions,
  type ThemeStyleOutput,
  writeStyleFile,
  toRelativeImportSpecifier,
} from '#auklet/css/production/format/shared';

export class ThemeStyleWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly packageContext: StylePackageContext;
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.packageContext = options.packageContext;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  clean(outRoot: string) {
    fs.rmSync(path.join(outRoot, THEMES_DIR), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(outRoot, this.config.output.styleDir, THEMES_DIR), {
      recursive: true,
      force: true,
    });
  }

  writeThemeStyles(outRoot: string) {
    const outputs: Array<ThemeStyleOutput> = [];
    const themesDir = path.join(
      outRoot,
      this.config.output.styleDir,
      THEMES_DIR,
    );

    for (const [themeName, stylePath] of this.packageContext.themeFiles) {
      const root = this.styleProcessor.createRoot();
      const content = this.styleProcessor.readStyleFile(stylePath);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, stylePath);
      }

      const target = path.join(themesDir, `${themeName}.css`);
      writeStyleFile(
        target,
        root.nodes?.length ? this.styleProcessor.stringify(root) : '',
      );
      outputs.push({ themeName, file: target });
    }

    return outputs;
  }

  writeThemeEntries(themeStyles: Map<string, string>, outRoot: string) {
    const outputs: Array<string> = [];
    const themesDir = path.join(outRoot, THEMES_DIR);

    for (const themeName of this.packageContext.themeNames) {
      const target = path.join(themesDir, `${themeName}.css`);
      const root = this.styleProcessor.createRoot();
      const targetDir = path.dirname(target);
      const themeStyle = themeStyles.get(themeName);

      for (const part of createThemeEntryParts(
        this.packageContext.normalizedConfig,
        themeName,
      )) {
        if (part.type === 'dependencies') {
          for (const specifier of part.specifiers) {
            this.styleProcessor.appendImportRule(root, specifier);
          }
          continue;
        }

        if (themeStyle) {
          this.styleProcessor.appendImportRule(
            root,
            toRelativeImportSpecifier(targetDir, themeStyle),
          );
        }
      }

      if (!root.nodes?.length) continue;

      writeStyleFile(target, this.styleProcessor.stringify(root));
      outputs.push(target);
    }

    return outputs;
  }
}
