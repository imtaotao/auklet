import path from 'node:path';
import type { ModuleStyleEntryPlan } from '#auklet/css/core/styleModuleEntryPlanner';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { createComponentStyleEntryPlans } from '#auklet/css/core/style/entries';
import { ComponentStyleEntryWriter } from '#auklet/css/production/format/componentWriter';
import { StyleEntryWriter } from '#auklet/css/production/format/entryWriter';
import { ExternalStyleWriter } from '#auklet/css/production/format/externalWriter';
import { ModuleStyleWriter } from '#auklet/css/production/format/moduleWriter';
import { SourceStyleFileWriter } from '#auklet/css/production/format/sourceWriter';
import { ThemeStyleWriter } from '#auklet/css/production/format/themeWriter';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export type ModuleStyleOutputWriterOptions = {
  config: ModuleStyleBuildConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
};

// Coordinates all module-mode style output under format directories such as `dist/es` and `dist/lib`.
export class ModuleStyleOutputWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly context: ResolvedModuleStyleBuildContext;
  private readonly packageContext: StylePackageContext;
  private readonly sourceWriter: SourceStyleFileWriter;
  private readonly themeWriter: ThemeStyleWriter;
  private readonly externalWriter: ExternalStyleWriter;
  private readonly moduleWriter: ModuleStyleWriter;
  private readonly entryWriter: StyleEntryWriter;
  private readonly componentWriter: ComponentStyleEntryWriter;

  constructor(options: ModuleStyleOutputWriterOptions) {
    this.config = options.config;
    this.context = options.context;
    this.packageContext = options.packageContext;
    this.sourceWriter = new SourceStyleFileWriter(options);
    this.themeWriter = new ThemeStyleWriter(options);
    this.externalWriter = new ExternalStyleWriter(options);
    this.moduleWriter = new ModuleStyleWriter(options);
    this.entryWriter = new StyleEntryWriter(options);
    this.componentWriter = new ComponentStyleEntryWriter(options);
  }

  write() {
    const componentEntries = this.createComponentEntries();
    const outputs: Array<string> = [];

    for (const format of this.config.output.outputFormats) {
      outputs.push(...this.writeFormat(format, componentEntries));
    }

    return outputs;
  }

  private get outputRoot() {
    return path.join(this.context.packageRoot, this.context.outputDir);
  }

  private createComponentEntries() {
    return createComponentStyleEntryPlans(this.packageContext);
  }

  private writeFormat(
    format: string,
    componentEntries: Array<ModuleStyleEntryPlan>,
  ) {
    const outRoot = path.join(this.outputRoot, format);
    const outputs: Array<string> = [];

    this.themeWriter.clean(outRoot);
    this.sourceWriter.copy(this.packageContext.styleFiles, outRoot);

    const themeStyles = this.themeWriter.writeThemeStyles(outRoot);
    const themeStyleMap = new Map(
      themeStyles.map((themeStyle) => [themeStyle.themeName, themeStyle.file]),
    );
    const themeEntries = this.themeWriter.writeThemeEntries(
      themeStyleMap,
      outRoot,
    );
    const externalStyle = this.externalWriter.write(outRoot);
    const moduleStyle = this.moduleWriter.write(outRoot);
    const entryStyle = this.entryWriter.write(
      outRoot,
      themeStyleMap,
      moduleStyle,
    );
    const componentStyles = this.componentWriter.write(
      outRoot,
      componentEntries,
    );

    outputs.push(...themeStyles.map((themeStyle) => themeStyle.file));
    outputs.push(...themeEntries);
    if (externalStyle) outputs.push(externalStyle);
    if (moduleStyle) outputs.push(moduleStyle);
    if (entryStyle) outputs.push(entryStyle);
    outputs.push(...componentStyles);

    return outputs;
  }
}
