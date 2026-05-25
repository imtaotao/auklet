import type { PublishTarget } from '#auklet/publish/types';
import { runPnpmBuild } from '#auklet/publish/api/pnpmApi';

export function validateBuildScript(targets: Array<PublishTarget>) {
  for (const target of targets) {
    const buildScript = target.packageJson.scripts?.build;
    if (typeof buildScript !== 'string' || !buildScript) {
      throw new Error(
        `[auklet:publish] package ${target.packageName} must define package.json#scripts.build before publishing.`,
      );
    }
  }
}

export async function runPackageBuilds(targets: Array<PublishTarget>) {
  for (const target of targets) {
    console.info(`[auklet:publish] build ${target.packageName}`);
    await runPnpmBuild(target.packageRoot);
  }
}
