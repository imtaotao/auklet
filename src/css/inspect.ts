import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isPlainObject, isString } from 'aidly';
import { normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { parseBuildOverrideArgs } from '#auklet/cli/parse/build';
import { AukletEnvContext } from '#auklet/env';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { mergeAukletConfigOverrides } from '#auklet/build/cliOverrides';
import {
  createExternalEntryParts,
  createModuleStyleEntryPlans,
  createStyleEntryParts,
  createThemeEntryParts,
} from '#auklet/css/core/style/entries';
import { toPosixPath } from '#auklet/utils';
import { createAukletLogger } from '#auklet/logger';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';
import type {
  AukletConfig,
  ModuleStyleBuildConfig,
  NormalizedAukletConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

const packageSeparator = '-'.repeat(84);

type CssInspectEntryRow = {
  entry: string;
  parts: Array<string>;
};

type CssInspectModuleRow = {
  sourceDir: string;
  imports: Array<string>;
  ownStyles: Array<string>;
};

export type CssInspectModel = {
  details: {
    packageName: string;
    packageRoot: string;
    source: string;
    output: string;
    modules: boolean;
    sourceFiles: number;
    styleFiles: number;
    themes: number;
    moduleEntries: number;
  };
  packageEntries: Array<CssInspectEntryRow>;
  themeFiles: Array<{ theme: string; file: string }>;
  styleFiles: Array<string>;
  moduleEntries: Array<CssInspectModuleRow>;
};

export async function runInspectCssCli(args: Array<string>) {
  const inspectOptions = await resolveInspectCssOptions(args);
  const models = inspectOptions.targets.map((target) =>
    createCssInspectModel(target),
  );
  new CssInspectReporter(inspectOptions.cwd, models).report();
  return 0;
}

export async function resolveInspectCssOptions(args: Array<string>) {
  const cwd = process.cwd();
  const buildArgs = parseBuildOverrideArgs(
    args.filter((arg) => arg !== '--'),
    new AukletEnvContext(cwd),
  );
  if (buildArgs.args.length) {
    throw new Error(
      `[inspect] unknown inspect css argument: ${buildArgs.args[0]}`,
    );
  }

  const workspaceRoot = findWorkspaceRoot(cwd);
  const packageRoots =
    workspaceRoot === cwd
      ? (await readPnpmWorkspacePackageInfo(cwd))
          .map((item) => path.resolve(item.path))
          .filter((packageRoot) => packageRoot !== cwd)
      : [cwd];

  return {
    cwd,
    targets: await Promise.all(
      packageRoots.map(async (packageRoot) => ({
        packageRoot,
        packageName: readPackageName(packageRoot),
        aukletConfig: mergeAukletConfigOverrides(
          await loadAukletConfig(packageRoot),
          buildArgs.config,
        ),
        config: moduleStyleBuildConfig,
      })),
    ),
  };
}

export function createCssInspectModel(options: {
  packageRoot: string;
  packageName?: string;
  aukletConfig?: AukletConfig;
  config?: ModuleStyleBuildConfig;
}) {
  const config = options.config ?? moduleStyleBuildConfig;
  const normalizedConfig = normalizeAukletConfig(options.aukletConfig ?? {});
  const context = createBuildContext(options.packageRoot, normalizedConfig);
  const packageContext = new StylePackageContext({
    config,
    context,
    normalizedConfig,
  });
  const moduleEntries = normalizedConfig.modules
    ? createModuleStyleEntryPlans(packageContext)
    : [];
  const packageEntries = createCssInspectEntryRows(
    config,
    normalizedConfig,
    packageContext,
  );

  return {
    details: {
      packageName: options.packageName ?? readPackageName(context.packageRoot),
      packageRoot: context.packageRoot,
      source: context.sourceDir,
      output: context.outputDir,
      modules: normalizedConfig.modules,
      sourceFiles: packageContext.sourceFiles.length,
      styleFiles: packageContext.styleFiles.length,
      themes: packageContext.themeFiles.size,
      moduleEntries: moduleEntries.length,
    },
    packageEntries,
    themeFiles: Array.from(packageContext.themeFiles.entries()).map(
      ([theme, file]) => ({
        theme,
        file: toRelativePath(context.packageRoot, file),
      }),
    ),
    styleFiles: packageContext.styleFiles.map((file) =>
      toRelativePath(context.packageRoot, file),
    ),
    moduleEntries: moduleEntries.map((entry) => ({
      sourceDir: toPosixPath(entry.sourceDir),
      imports: sortStyleDependencies(entry.moduleStyleImports),
      ownStyles: entry.ownStyleFiles.map((file) =>
        toRelativePath(context.packageRoot, file),
      ),
    })),
  } satisfies CssInspectModel;
}

const createCssInspectEntryRows = (
  config: ModuleStyleBuildConfig,
  normalizedConfig: NormalizedAukletConfig,
  packageContext: StylePackageContext,
) => {
  const rows: Array<CssInspectEntryRow> = [];
  const styleEntryParts = createStyleEntryParts(normalizedConfig);
  const externalEntryParts = createExternalEntryParts(normalizedConfig);

  if (
    packageContext.styleFiles.length ||
    packageContext.themeFiles.size ||
    hasDependencyParts(styleEntryParts)
  ) {
    rows.push({
      entry: config.output.indexStyleFile,
      parts: styleEntryParts.map(formatEntryPart),
    });
  }

  if (hasDependencyParts(externalEntryParts)) {
    rows.push({
      entry: path.posix.join(
        config.output.styleDir,
        config.output.externalStyleFile,
      ),
      parts: externalEntryParts.map(formatEntryPart),
    });
  }

  rows.push(
    ...packageContext.themeNames.map((themeName) => ({
      entry: path.posix.join(config.output.styleDir, `${themeName}.css`),
      parts: createThemeEntryParts(normalizedConfig, themeName).map(
        formatEntryPart,
      ),
    })),
  );

  return rows;
};

const hasDependencyParts = (parts: Array<{ type: string }>) => {
  return parts.some((part) => {
    if (part.type !== 'dependencies') return false;
    const specifiers = Reflect.get(part, 'specifiers') as Array<string>;
    return specifiers.length > 0;
  });
};

const createBuildContext = (
  packageRoot: string,
  config: NormalizedAukletConfig,
) => {
  return {
    packageRoot,
    sourceDir: config.source,
    outputDir: config.output,
  } satisfies ResolvedModuleStyleBuildContext;
};

const readPackageName = (packageRoot: string) => {
  const packageJson = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as unknown;
  if (!isPlainObject(packageJson) || !isString(packageJson.name)) {
    return path.basename(packageRoot);
  }
  return packageJson.name;
};

const formatEntryPart = (part: { type: string }) => {
  if (part.type === 'dependencies') {
    const specifiers = Reflect.get(part, 'specifiers') as Array<string>;
    return specifiers.length
      ? `dependencies: ${specifiers.join(', ')}`
      : 'dependencies: none';
  }
  if (part.type === 'themes') {
    const themeNames = Reflect.get(part, 'themeNames') as Array<string>;
    return themeNames.length ? `themes: ${themeNames.join(', ')}` : 'themes';
  }
  if (part.type === 'theme') {
    return `theme: ${String(Reflect.get(part, 'themeName'))}`;
  }
  return part.type;
};

const toRelativePath = (root: string, file: string) => {
  return toPosixPath(path.relative(root, file));
};

const sortStyleDependencies = (dependencies: Array<string>) => {
  return [...dependencies].sort((left, right) => {
    const leftExternal = isExternalStyleDependency(left);
    const rightExternal = isExternalStyleDependency(right);
    if (leftExternal !== rightExternal) return leftExternal ? -1 : 1;
    return left.localeCompare(right);
  });
};

const isExternalStyleDependency = (dependency: string) => {
  return !dependency.startsWith('.') && !dependency.startsWith('/');
};

class CssInspectReporter {
  private readonly logger = createAukletLogger();

  constructor(
    private readonly cwd: string,
    private readonly models: Array<CssInspectModel>,
  ) {}

  report() {
    this.logger.newline();

    this.logger.result({
      title: this.logger.colors.bold(this.logger.colors.green('CSS inspect')),
      status: 'info',
      body: [this.logger.colors.gray('Read-only CSS plan. No files changed.')],
      details: {
        packages: this.formatValue(this.models.length),
        styles: this.formatValue(
          this.models.reduce(
            (total, model) => total + model.details.styleFiles,
            0,
          ),
        ),
        themes: this.formatValue(
          this.models.reduce((total, model) => total + model.details.themes, 0),
        ),
        entries: this.formatValue(
          this.models.reduce(
            (total, model) => total + model.details.moduleEntries,
            0,
          ),
        ),
      },
    });

    for (const [index, model] of this.models.entries()) {
      this.logger.newline();
      if (index > 0) {
        this.writePackageSeparator();
        this.logger.newline();
      }
      this.reportPackage(model);
    }

    this.logger.newline();
  }

  private reportPackage(model: CssInspectModel) {
    this.logger.result({
      title: this.formatPackage(model.details.packageName),
      status: 'info',
      details: {
        root: this.logger.path(
          toRelativePath(this.cwd, model.details.packageRoot) || '.',
        ),
        source: this.logger.path(model.details.source),
        output: this.logger.path(model.details.output),
        modules: this.formatValue(model.details.modules ? 'on' : 'off'),
        styles: this.formatValue(model.details.styleFiles),
        themes: this.formatValue(model.details.themes),
        entries: this.formatValue(model.details.moduleEntries),
      },
    });

    this.logger.newline();

    this.writeSectionTitle('Output entries');
    this.logger.rows({
      columns: this.formatColumns(['entry', 'parts']),
      rows: model.packageEntries.map((entry) => [
        this.logger.path(entry.entry),
        this.formatEntryParts(entry.parts),
      ]),
      empty: this.logger.colors.gray('No package-level CSS entries found.'),
    });

    this.logger.newline();

    this.writeSectionTitle('Theme files');
    this.logger.rows({
      columns: this.formatColumns(['theme', 'file']),
      rows: model.themeFiles.map((theme) => [
        this.formatTheme(theme.theme),
        this.logger.path(theme.file),
      ]),
      empty: this.logger.colors.gray('No theme files configured.'),
    });

    this.logger.newline();

    this.writeSectionTitle('Module entries');
    this.writeModuleEntries(model);
  }

  private writeSectionTitle(title: string) {
    this.logger.raw(title);
  }

  private writePackageSeparator() {
    this.logger.raw(this.logger.colors.gray(packageSeparator));
  }

  private writeModuleEntries(model: CssInspectModel) {
    if (!model.moduleEntries.length) {
      this.logger.empty(
        model.details.modules
          ? this.logger.colors.gray('No module style entries found.')
          : this.logger.colors.gray('Module output is disabled.'),
      );
      return;
    }

    for (const [index, entry] of model.moduleEntries.entries()) {
      if (index > 0) this.logger.newline();
      this.logger.rows({
        title: this.formatSource(entry.sourceDir),
        columns: this.formatColumns(['type', 'file']),
        rows: [
          ...this.createModuleEntryRows('own style', entry.ownStyles, (value) =>
            this.formatOwnStyle(value),
          ),
          ...this.createModuleEntryRows('dependency', entry.imports, (value) =>
            this.formatDependency(value),
          ),
        ],
      });
    }
  }

  private createModuleEntryRows(
    title: string,
    values: Array<string>,
    format: (value: string) => string,
  ) {
    if (!values.length) {
      return [
        [this.logger.colors.gray(title), this.logger.colors.gray('none')],
      ];
    }

    return values.map((value) => [
      this.logger.colors.gray(title),
      format(value),
    ]);
  }

  private formatColumns(columns: Array<string>) {
    return columns.map((column) => this.logger.colors.gray(column));
  }

  private formatEntryParts(parts: Array<string>) {
    return parts.flatMap((part, index) => [
      ...(index > 0 ? [this.logger.colors.gray(' | ')] : []),
      this.formatEntryPart(part),
    ]);
  }

  private formatEntryPart(part: string) {
    if (part.startsWith('dependencies:')) {
      return this.logger.colors.yellow(part);
    }
    if (part.startsWith('themes:') || part.startsWith('theme:')) {
      return this.logger.colors.hex('#7c3aed')(part);
    }
    if (part === 'module') return this.logger.colors.green(part);
    return this.logger.colors.gray(part);
  }

  private formatSource(value: string) {
    return this.logger.colors.bold(this.logger.colors.cyan(value));
  }

  private formatDependency(value: string) {
    return this.logger.colors.yellow(value);
  }

  private formatOwnStyle(value: string) {
    return this.logger.colors.green(value);
  }

  private formatTheme(value: string) {
    return this.logger.colors.bold(this.logger.colors.hex('#7c3aed')(value));
  }

  private formatPackage(value: string) {
    return this.logger.colors.bold(this.logger.colors.hex('#5b21b6')(value));
  }

  private formatValue(value: string | number) {
    return this.logger.colors.bold(this.logger.colors.cyan(String(value)));
  }
}
