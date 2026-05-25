import {
  readPackageJson,
  writePackageJson,
} from '#auklet/publish/api/packageJsonApi';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class VersionWriter {
  constructor(private readonly options: PublishOptions) {}

  writeBeforeBuild(plan: PublishPlan) {
    if (!plan.dryRun && this.options.version) {
      this.writeVersions(plan);
    }
  }

  logDryRunPlan(plan: PublishPlan) {
    if (!plan.dryRun || !this.options.version) return;

    console.info(
      '[auklet:publish] dry-run mode: package.json files will not be changed',
    );
    if (plan.workspaceMode === 'monorepo') {
      const rootPackageJson = readPackageJson(plan.root);
      console.info(
        `[auklet:publish] planned shared version: ${rootPackageJson.version} -> ${plan.version}`,
      );
      for (const target of plan.targets) {
        console.info(
          `[auklet:publish] planned package ${target.packageName}: ${target.version} -> ${target.publishVersion}`,
        );
      }
      console.info(
        '[auklet:publish] builds will still read each package.json#version',
      );
      console.info(
        '[auklet:publish] pnpm publish --dry-run will still read each package.json#version',
      );
      return;
    }

    const [target] = plan.targets;
    if (target) {
      console.info(
        `[auklet:publish] planned version ${target.packageName}: ${target.version} -> ${target.publishVersion}`,
      );
      console.info(
        `[auklet:publish] build will still read package.json#version: ${target.version}`,
      );
      console.info(
        `[auklet:publish] pnpm publish --dry-run will still read package.json#version: ${target.version}`,
      );
    }
  }

  logWrittenVersionFailure(plan: PublishPlan) {
    if (!plan.dryRun && this.options.version) {
      console.error(
        '[auklet:publish] package.json versions may have been written. Auklet will not roll them back; check publish output before retrying.',
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
        console.info(
          `[auklet:publish] writing version ${packageName}: ${packageJson.version} -> ${plan.version}`,
        );
      }
      packageJson.version = plan.version;
      writePackageJson(packageRoot, packageJson);
    }
  }
}
