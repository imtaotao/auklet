import path from 'node:path';
import { isString } from 'aidly';
import { AukletEnvContext } from '#auklet/env';
import { createAukletLogger } from '#auklet/logger';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { getPublishRegistry } from '#auklet/publish/api/registry';
import { resolvePublishTag } from '#auklet/publish/api/publishArgs';
import { parsePublishCommand } from '#auklet/cli/parse/publish';
import { validateNpmrcAuthEnv } from '#auklet/publish/api/npmrc';
import { createPublishRootEnv } from '#auklet/publish/publishEnv';
import {
  inspectPublishRegistry,
  type PublishRegistryCheck,
} from '#auklet/publish/inspectRegistry';
import {
  inspectPackageFiles,
  PackInspectReporter,
  type PackFileCheck,
} from '#auklet/publish/inspectPack';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import type {
  PackageJson,
  PublishOptions,
  PublishPackageConfig,
  PublishPlan,
  PublishRuntime,
  PublishTarget,
} from '#auklet/publish/types';

type PublishInspectTargetRow = {
  packageName: string;
  version: string;
  publishVersion: string;
  registry: string;
  access: string;
};

type PublishInspectHookRow = {
  name: string;
  configured: boolean;
};

type PublishInspectModel = {
  details: {
    mode: string;
    publish: string;
    packages: number;
    version: string;
    tag: string;
    git: string;
    format: string;
    root: string;
  };
  packageFileChecks: Array<PackFileCheck>;
  targets: Array<PublishInspectTargetRow>;
  registryChecks: Array<PublishRegistryCheck>;
  hooks: Array<PublishInspectHookRow>;
};

export async function runInspectPublishCli(args: Array<string>) {
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const envContext = new AukletEnvContext(cwd, root);

  return envContext.run(async () => {
    const options = parsePublishCommand(args, { cwd, envContext });
    return runInspectPublish(options, root, { envContext });
  });
}

async function runInspectPublish(
  options: PublishOptions,
  root: string,
  runtime: PublishRuntime,
) {
  const { env } = createPublishRootEnv(options, runtime);
  validateNpmrcAuthEnv(options.cwd, root, { env });
  await ensurePnpm({ env });
  const logger = createAukletLogger({ scope: 'inspect' });
  const plan = await resolvePublishPlan(options, runtime, logger);
  const packageFileChecks = inspectPackageFiles(plan.targets);
  const packageFileCheckFailed = packageFileChecks.some(
    (check) => check.status === 'missing',
  );
  if (packageFileCheckFailed) {
    new PublishInspectReporter(options, plan, packageFileChecks, []).report();
    return 1;
  }

  const spinner = logger.spinner('Checking publish registry');
  spinner.start();
  const registryChecks = await inspectPublishRegistry(plan, {
    token: options.token,
    runtime,
    onCheck: (info) => {
      spinner.text([
        'Checking registry ',
        info.check,
        ' for ',
        logger.package(info.packageName),
      ]);
    },
    onRetry: (info) => {
      spinner.text([
        'Checking registry ',
        info.check,
        ' for ',
        logger.package(info.packageName),
        ', retrying ',
        logger.value(`${info.attempt}/${info.maxAttempts}`),
      ]);
    },
  });

  if (registryChecks.some((check) => check.reason)) {
    spinner.fail('Publish registry checks failed');
  } else {
    spinner.succeed('Publish registry checks passed');
  }

  new PublishInspectReporter(
    options,
    plan,
    packageFileChecks,
    registryChecks,
  ).report();
  if (registryChecks.some((check) => check.reason)) {
    return 1;
  }
  return 0;
}

class PublishInspectReporter {
  private readonly logger = createAukletLogger();

  constructor(
    private readonly options: PublishOptions,
    private readonly plan: PublishPlan,
    private readonly packageFileChecks: Array<PackFileCheck>,
    private readonly registryChecks: Array<PublishRegistryCheck>,
  ) {}

  report() {
    const model = createPublishInspectModel(
      this.options,
      this.plan,
      this.packageFileChecks,
      this.registryChecks,
    );

    new PackInspectReporter(
      this.options.cwd,
      this.plan.targets,
      model.packageFileChecks,
      'Package file checks',
    ).report();

    this.logger.newline();
    this.logger.result({
      title: this.formatResultTitle(
        'Publish inspect',
        model.registryChecks.some((check) => check.reason),
      ),
      status: 'info',
      body: [
        'Read-only publish plan. No files, git refs, or packages changed.',
      ],
      details: this.formatDetails(model),
    });

    this.logger.newline();
    this.writeSectionTitle('Targets');
    this.logger.rows({
      columns: ['package', 'version', 'registry', 'access'],
      rows: model.targets.map((target) => [
        this.logger.package(target.packageName),
        this.formatVersionChange(target.version, target.publishVersion),
        this.logger.colors.gray(target.registry),
        this.logger.colors.gray(target.access),
      ]),
    });

    this.logger.newline();
    this.writeSectionTitle('Registry checks');
    this.logger.rows({
      columns: ['package', 'registry', 'auth', 'version'],
      rows: model.registryChecks.map((check) => [
        this.logger.package(check.packageName),
        this.logger.colors.gray(check.registry),
        this.formatCheckStatus(check.auth),
        this.formatCheckStatus(check.version),
      ]),
    });

    const failedChecks = model.registryChecks.filter((check) => check.reason);
    if (failedChecks.length) {
      this.logger.newline();
      this.writeSectionTitle('Registry issues', 'error');
      this.writeRegistryIssues(failedChecks);
    }

    this.logger.newline();
    this.writeSectionTitle('Hooks');
    this.logger.rows({
      columns: ['hook', 'configured'],
      rows: model.hooks.map((hook) => [
        this.logger.colors.gray(hook.name),
        this.formatValue(hook.configured ? 'yes' : 'no'),
      ]),
    });
    this.logger.newline();
  }

  private formatDetails(model: PublishInspectModel) {
    return {
      mode: this.formatValue(model.details.mode),
      publish: this.formatValue(model.details.publish),
      packages: this.formatValue(model.details.packages),
      version: this.logger.version(model.details.version),
      tag: this.formatValue(model.details.tag),
      git: this.formatValue(model.details.git),
      format: this.formatValue(model.details.format),
      root: this.logger.path(model.details.root),
    };
  }

  private formatVersionChange(from: string, to: string) {
    return [
      this.logger.version(from),
      this.logger.colors.gray(' -> '),
      this.logger.version(to),
    ];
  }

  private formatValue(value: string | number) {
    return this.logger.colors.bold(this.logger.colors.cyan(String(value)));
  }

  private formatResultTitle(title: string, failed: boolean) {
    return this.logger.colors.bold(
      failed ? this.logger.colors.red(title) : this.logger.colors.green(title),
    );
  }

  private formatCheckStatus(status: PublishRegistryCheck['auth']) {
    if (status === 'success') return this.logger.colors.green('ok');
    return this.logger.colors.red('failed');
  }

  private writeSectionTitle(
    title: string,
    status: 'normal' | 'error' = 'normal',
  ) {
    const content = status === 'error' ? this.logger.colors.red(title) : title;
    this.logger.raw(content);
  }

  private writeRegistryIssues(checks: Array<PublishRegistryCheck>) {
    for (const [index, check] of checks.entries()) {
      if (index > 0) this.logger.newline();
      const [firstLine, ...restLines] = String(check.reason ?? '').split('\n');
      this.logger.item(
        this.logger.package(check.packageName),
        ': ',
        this.logger.colors.red(firstLine),
      );
      for (const line of restLines) {
        this.logger.raw(`    ${this.logger.colors.red(line)}`);
      }
    }
  }
}

export function createPublishInspectModel(
  options: PublishOptions,
  plan: PublishPlan,
  packageFileChecks: Array<PackFileCheck> = [],
  registryChecks: Array<PublishRegistryCheck> = [],
) {
  return {
    details: {
      mode: plan.workspaceMode,
      publish: plan.dryRun ? 'dry-run' : 'real',
      packages: plan.targets.length,
      version: plan.version,
      tag: resolvePublishTag(options.version) ?? 'latest',
      git: getGitMode(options),
      format: options.format ? 'enabled' : 'disabled',
      root: path.relative(options.cwd, plan.root) || '.',
    },
    packageFileChecks,
    targets: plan.targets.map((target) => ({
      packageName: target.packageName,
      version: target.version,
      publishVersion: target.publishVersion,
      registry: getRegistry(target.packageJson),
      access: getAccess(target),
    })),
    registryChecks,
    hooks: getHookRows(plan.config),
  } satisfies PublishInspectModel;
}

const getGitMode = (options: PublishOptions) => {
  if (options.dryRun) return 'skipped (dry-run)';
  if (options.allowDirty) return 'skipped (--allow-dirty)';
  if (options.git === false) return 'skipped (--no-git)';
  return 'commit + tag';
};

const getHookRows = (config: PublishPackageConfig) => {
  const hooks: Array<
    [string, PublishPackageConfig[keyof PublishPackageConfig]]
  > = [
    ['beforeBuild', config.beforeBuild],
    ['afterBuild', config.afterBuild],
    ['beforePublish', config.beforePublish],
    ['afterPublish', config.afterPublish],
  ];
  return hooks.map(([name, value]) => ({
    name,
    configured: Boolean(value),
  }));
};

const getRegistry = (packageJson: PackageJson) => {
  return getPublishRegistry(packageJson.publishConfig) ?? 'default';
};

const getAccess = (target: PublishTarget) => {
  const access = target.packageJson.publishConfig?.access;
  if (isString(access) && access) return access;
  if (target.packageName.startsWith('@') && !target.private) return 'public';
  return 'default';
};
