import fs from 'node:fs';
import path from 'node:path';
import { isArray, isPlainObject, isString } from 'aidly';
import { createAukletLogger } from '#auklet/logger';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import type { PackageJson, PublishTarget } from '#auklet/publish/types';

export type PackFileCheckStatus = 'exists' | 'missing' | 'pattern' | 'skipped';

export type PackFileCheck = {
  target: PublishTarget;
  field: string;
  file: string;
  status: PackFileCheckStatus;
};

export async function runInspectPackCli(args: Array<string>) {
  const options = resolveInspectPackOptions(args);
  const logger = createAukletLogger({ scope: 'inspect' });
  const plan = await resolvePublishPlan(
    {
      cwd: options.cwd,
      filters: options.filters,
      dryRun: true,
      version: undefined,
    },
    logger,
  );

  const checks = inspectPackageFiles(plan.targets);
  new PackInspectReporter(options.cwd, plan.targets, checks).report();
  return checks.some((check) => check.status === 'missing') ? 1 : 0;
}

const resolveInspectPackOptions = (args: Array<string>) => {
  const filters: Array<string> = [];
  const cliArgs = args.filter((arg) => arg !== '--');

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (arg === '--filter') {
      const value = cliArgs[index + 1];
      if (!value) throw new Error('[inspect] --filter requires a value.');
      filters.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--filter=')) {
      filters.push(arg.slice('--filter='.length));
      continue;
    }
    throw new Error(`[inspect] unknown inspect pack argument: ${arg}`);
  }

  return {
    cwd: process.cwd(),
    filters,
  };
};

export function inspectPackageFiles(targets: Array<PublishTarget>) {
  return targets.flatMap((target) => inspectTargetPackage(target));
}

const inspectTargetPackage = (target: PublishTarget) => {
  return collectPackageFileReferences(target.packageJson).map((reference) => ({
    target,
    field: reference.field,
    file: reference.file,
    status: getFileStatus(target.packageRoot, reference.file),
  }));
};

const collectPackageFileReferences = (packageJson: PackageJson) => {
  const references: Array<{ field: string; file: string }> = [];

  addStringField(references, packageJson, 'main');
  addStringField(references, packageJson, 'module');
  addStringField(references, packageJson, 'types');
  addStringField(references, packageJson, 'typings');
  addStringField(references, packageJson, 'style');
  addStringField(references, packageJson, 'stylesheet');
  addBinFields(references, packageJson.bin);
  addExportFields(references, packageJson.exports, 'exports');
  addFilesFields(references, packageJson.files);

  return references;
};

const addStringField = (
  references: Array<{ field: string; file: string }>,
  packageJson: PackageJson,
  field: string,
) => {
  const value = Reflect.get(packageJson, field);
  if (isString(value)) references.push({ field, file: value });
};

const addBinFields = (
  references: Array<{ field: string; file: string }>,
  value: unknown,
) => {
  if (isString(value)) {
    references.push({ field: 'bin', file: value });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [name, file] of Object.entries(value)) {
    if (isString(file)) references.push({ field: `bin.${name}`, file });
  }
};

const addExportFields = (
  references: Array<{ field: string; file: string }>,
  value: unknown,
  field: string,
) => {
  if (isString(value)) {
    references.push({ field, file: value });
    return;
  }
  if (isArray(value)) {
    value.forEach((item, index) => {
      addExportFields(references, item, `${field}[${index}]`);
    });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    addExportFields(references, item, formatFieldKey(field, key));
  }
};

const addFilesFields = (
  references: Array<{ field: string; file: string }>,
  value: unknown,
) => {
  if (!isArray(value)) return;
  value.forEach((file, index) => {
    if (isString(file)) references.push({ field: `files[${index}]`, file });
  });
};

const getFileStatus = (
  packageRoot: string,
  file: string,
): PackFileCheckStatus => {
  if (file.startsWith('!')) return 'skipped';
  if (file.startsWith('#') || file.includes('://')) return 'skipped';
  if (file.includes('*')) return 'pattern';
  const absolutePath = path.resolve(packageRoot, file);
  const relativePath = path.relative(packageRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return 'skipped';
  }
  return fs.existsSync(absolutePath) ? 'exists' : 'missing';
};

const formatFieldKey = (field: string, key: string) => {
  return /^[a-zA-Z_$][\w$-]*$/.test(key)
    ? `${field}.${key}`
    : `${field}[${JSON.stringify(key)}]`;
};

export class PackInspectReporter {
  private readonly logger = createAukletLogger();

  constructor(
    private readonly cwd: string,
    private readonly targets: Array<PublishTarget>,
    private readonly checks: Array<PackFileCheck>,
    private readonly title = 'Pack inspect',
  ) {}

  report() {
    const missingChecks = this.checks.filter(
      (check) => check.status === 'missing',
    );

    this.logger.newline();

    this.logger.result({
      title: this.formatResultTitle(this.title, missingChecks.length > 0),
      status: missingChecks.length ? 'error' : 'info',
      body: ['Read-only package file checks. No files or packages changed.'],
      details: {
        packages: this.formatValue(this.targets.length),
        checks: this.formatValue(this.checks.length),
        missing: missingChecks.length
          ? this.logger.colors.bold(
              this.logger.colors.red(missingChecks.length),
            )
          : this.formatValue(0),
      },
    });

    this.logger.newline();

    this.writeSectionTitle('Package files');
    this.logger.rows({
      columns: ['package', 'field', 'file', 'status'],
      rows: this.checks.map((check) => [
        this.logger.package(check.target.packageName),
        this.logger.colors.gray(check.field),
        this.logger.path(check.file),
        this.formatStatus(check.status),
      ]),
      empty: this.logger.colors.gray('No package file references found.'),
    });

    this.logger.newline();

    this.writeSectionTitle('Package roots');
    this.logger.rows({
      columns: ['package', 'root'],
      rows: this.targets.map((target) => [
        this.logger.package(target.packageName),
        this.logger.path(path.relative(this.cwd, target.packageRoot) || '.'),
      ]),
    });

    if (missingChecks.length) {
      this.logger.newline();
      this.writeSectionTitle('Missing files', 'error');
      for (const [index, check] of missingChecks.entries()) {
        if (index > 0) this.logger.newline();
        this.logger.item(
          this.logger.package(check.target.packageName),
          ': ',
          this.logger.colors.red(check.field),
          ' -> ',
          this.logger.colors.red(check.file),
        );
      }
    }

    this.logger.newline();
  }

  private writeSectionTitle(
    title: string,
    status: 'normal' | 'error' = 'normal',
  ) {
    const content = status === 'error' ? this.logger.colors.red(title) : title;
    this.logger.raw(content);
  }

  private formatStatus(status: PackFileCheckStatus) {
    if (status === 'exists') return this.logger.colors.green('exists');
    if (status === 'missing') return this.logger.colors.red('missing');
    if (status === 'pattern') return this.logger.colors.yellow('pattern');
    return this.logger.colors.gray('skipped');
  }

  private formatValue(value: string | number) {
    return this.logger.colors.bold(this.logger.colors.cyan(String(value)));
  }

  private formatResultTitle(title: string, failed: boolean) {
    return this.logger.colors.bold(
      failed ? this.logger.colors.red(title) : this.logger.colors.green(title),
    );
  }
}
