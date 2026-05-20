import fs from 'node:fs';
import path from 'node:path';
import type { ModuleStyleEntryPlan } from '#auklet/css/core/styleModuleEntryPlanner';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import {
  emptyModuleEntryComment,
  type FormatWriterOptions,
} from '#auklet/css/production/format/shared';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import { toPosixPath } from '#auklet/utils';

export class ComponentStyleEntryWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly sourceRoot: string;
  private readonly resolver: StylePackageContext['resolver'];
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.sourceRoot = options.packageContext.sourceRoot;
    this.resolver = options.packageContext.resolver;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  write(outRoot: string, entries: Array<ModuleStyleEntryPlan>) {
    const outputs: Array<string> = [];

    for (const entry of entries) {
      const styleDir = path.join(
        outRoot,
        entry.sourceDir,
        this.config.output.styleDir,
      );
      const target = path.join(styleDir, this.config.output.indexStyleFile);
      const sourceStyleSpecifiers = [
        ...this.getModuleStyleSpecifiers(entry.moduleStyleImports, styleDir),
        ...this.getOwnStyleSpecifiers(entry.ownStyleFiles, styleDir, outRoot),
      ];
      const root = this.styleProcessor.createRoot();
      const seen = new Set<string>();

      for (const specifier of sourceStyleSpecifiers) {
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        this.styleProcessor.appendImportRule(
          root,
          this.resolver.toOutputStyleSpecifier(specifier, outRoot),
        );
      }

      fs.mkdirSync(styleDir, { recursive: true });
      fs.writeFileSync(
        target,
        root.nodes?.length
          ? this.styleProcessor.stringify(root)
          : emptyModuleEntryComment,
      );
      outputs.push(target);
    }

    return outputs;
  }

  private getModuleStyleSpecifiers(
    specifiers: Array<string>,
    styleDir: string,
  ) {
    return specifiers.map((specifier) => {
      if (specifier.startsWith('.')) return specifier;
      if (!path.isAbsolute(specifier)) return specifier;
      return toPosixPath(path.relative(styleDir, specifier));
    });
  }

  private getOwnStyleSpecifiers(
    ownStyleFiles: Array<string>,
    styleDir: string,
    outRoot: string,
  ) {
    return ownStyleFiles.map((styleFile) =>
      toPosixPath(
        path.relative(
          styleDir,
          path.join(outRoot, path.relative(this.sourceRoot, styleFile)),
        ),
      ),
    );
  }
}
