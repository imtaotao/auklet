import {
  readPackageJson,
  writePackageJson,
} from '#auklet/publish/api/packageJsonApi';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';
import type { AukletLogger } from '#auklet/logger';

export class VersionWriter {
  constructor(
    private readonly options: PublishOptions,
    private readonly logger: AukletLogger,
  ) {}

  writeBeforeBuild(plan: PublishPlan) {
    if (!plan.dryRun && this.options.version) {
      this.writeVersions(plan);
    }
  }

  logDryRunPlan(plan: PublishPlan) {
    if (!plan.dryRun || !this.options.version) return;

    const logger = this.logger;
    logger.info('dry-run mode: package.json files will not be changed');
    if (plan.workspaceMode === 'monorepo') {
      const rootPackageJson = readPackageJson(plan.root);
      logger.summary({
        title: 'Publish dry-run plan',
        values: {
          mode: plan.workspaceMode,
          sharedVersion: this.formatVersionChange(
            rootPackageJson.version,
            plan.version,
          ),
          targets: plan.targets.length,
        },
      });
      for (const target of plan.targets) {
        logger.info(
          'planned package ',
          this.formatPackage(target.packageName),
          ': ',
          ...this.formatVersionChange(target.version, target.publishVersion),
        );
      }
      logger.info('builds will still read each package.json#version');
      logger.info(
        'pnpm publish --dry-run will still read each package.json#version',
      );
      return;
    }

    const [target] = plan.targets;
    if (target) {
      logger.summary({
        title: 'Publish dry-run plan',
        values: {
          package: this.formatPackage(target.packageName),
          version: this.formatVersionChange(
            target.version,
            target.publishVersion,
          ),
        },
      });
      logger.info(
        `build will still read package.json#version: ${target.version}`,
      );
      logger.info(
        `pnpm publish --dry-run will still read package.json#version: ${target.version}`,
      );
    }
  }

  logWrittenVersionFailure(plan: PublishPlan) {
    if (!plan.dryRun && this.options.version) {
      this.logger.error(
        'package.json versions may have been written. Auklet will not roll them back; check publish output before retrying.',
      );
    }
  }

  private writeVersions(plan: PublishPlan) {
    const packageRoots = new Set([
      plan.root,
      ...plan.targets.map((target) => target.packageRoot),
    ]);

    for (const packageRoot of packageRoots) {
      const packageJson = readPackageJson(packageRoot);
      const packageName =
        plan.targets.find((target) => target.packageRoot === packageRoot)
          ?.packageName ?? (packageRoot === plan.root ? 'root' : packageRoot);

      if (packageJson.version !== plan.version) {
        this.logger.info(
          'writing version ',
          this.formatPackage(packageName),
          ': ',
          ...this.formatVersionChange(packageJson.version, plan.version),
        );
      }
      packageJson.version = plan.version;
      writePackageJson(packageRoot, packageJson);
    }
  }

  private formatPackage(packageName: string) {
    return this.logger.package(packageName);
  }

  private formatVersionChange(from: unknown, to: string) {
    const logger = this.logger;
    const fromVersion = String(from);
    return [logger.version(fromVersion), ' -> ', logger.version(to)];
  }
}
