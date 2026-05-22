import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { writeStyleFile } from '#auklet/css/production/format/shared';
import { getGlobalStyleDependencies } from '#auklet/css/core/style/dependencies';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export type PackageStyleEntryWriterOptions = {
  config: ModuleStyleBuildConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
};

// Builds the package-level style entry at `dist/index.css` by aggregating local themes, dependencies, and source styles.
export class PackageStyleEntryWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly context: ResolvedModuleStyleBuildContext;
  private readonly packageContext: StylePackageContext;
  private readonly resolver: StylePackageContext['resolver'];
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: PackageStyleEntryWriterOptions) {
    this.config = options.config;
    this.context = options.context;
    this.packageContext = options.packageContext;
    this.resolver = options.packageContext.resolver;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  write() {
    const seen = new Set<string>();
    const root = this.styleProcessor.createRoot();

    for (const stylePath of this.packageContext.themeFiles.values()) {
      const content = this.styleProcessor.readStyleFile(stylePath, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, stylePath);
      }
    }

    for (const specifier of getGlobalStyleDependencies(
      this.packageContext.normalizedConfig,
    )) {
      const stylePath = this.resolver.resolveStyleDependency(specifier);
      if (!stylePath) continue;
      const content = this.styleProcessor.readStyleFile(stylePath, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, stylePath);
      }
    }

    for (const styleFile of this.packageContext.styleFiles) {
      const content = this.styleProcessor.readStyleFile(styleFile, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, styleFile);
      }
    }

    if (!root.nodes?.length) return null;

    const target = path.join(
      this.outputRoot,
      this.config.output.indexStyleFile,
    );
    writeStyleFile(target, this.styleProcessor.stringify(root));
    return target;
  }

  private get outputRoot() {
    return path.join(this.context.packageRoot, this.context.outputDir);
  }
}
