import { runPublishHook } from '#auklet/publish/api/publishHookApi';
import {
  runPackageBuilds,
  validateBuildScript,
} from '#auklet/publish/runner/packageBuilder';
import { formatPublishOutputs } from '#auklet/publish/runner/publishOutputFormatter';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import { PackagePublisher } from '#auklet/publish/runner/packagePublisher';
import { reportPublishFailure } from '#auklet/publish/runner/publishFailureReporter';
import { PublishPreflight } from '#auklet/publish/runner/publishPreflight';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import { ReleaseGitController } from '#auklet/publish/runner/releaseGitController';
import { VersionWriter } from '#auklet/publish/runner/versionWriter';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class PublishRunner {
  private readonly git: ReleaseGitController;
  private readonly publisher: PackagePublisher;
  private readonly preflight: PublishPreflight;
  private readonly versions: VersionWriter;

  constructor(private readonly options: PublishOptions) {
    this.git = new ReleaseGitController(options);
    this.publisher = new PackagePublisher(options);
    this.preflight = new PublishPreflight(options);
    this.versions = new VersionWriter(options);
  }

  async run() {
    const plan = await this.preparePlan();
    let failureHookEnabled = false;

    try {
      await runPublishHook({ status: 'beforeBuild', plan });
      failureHookEnabled = true;
      this.versions.writeBeforeBuild(plan);
      await runPackageBuilds(plan.targets);
      await runPublishHook({ status: 'afterBuild', plan });
      await formatPublishOutputs(plan.targets, plan.config.format !== false);
      await runPublishHook({ status: 'beforePublish', plan });
      await this.publishWithPlan(plan);
    } catch (error) {
      if (!failureHookEnabled) throw error;
      await this.handleFailure(plan, error);
    }

    await this.runAfterPublishSuccess(plan);
  }

  private async preparePlan() {
    const plan = await resolvePublishPlan(this.options);
    validateBuildScript(plan.targets);

    await this.git.checkBeforePublish(plan);
    this.versions.logDryRunPlan(plan);

    return plan;
  }

  private async publishWithPlan(plan: PublishPlan) {
    if (plan.dryRun) {
      await this.preflight.run(plan);
      return;
    }

    await this.preflight.run(plan);
    await this.git.commitAndTag(plan);
    await this.publisher.run(plan);
  }

  private async handleFailure(plan: PublishPlan, error: unknown) {
    const failedTarget =
      error instanceof PublishTargetError ? error.target : undefined;
    try {
      await runPublishHook({
        status: 'afterPublish',
        plan,
        result: 'failure',
        failedTarget,
        error:
          error instanceof PublishTargetError ? error.originalError : error,
      });
    } catch (hookError) {
      console.error(hookError);
    }

    if (error instanceof PublishTargetError) {
      reportPublishFailure(error, plan.version);
    }
    this.versions.logWrittenVersionFailure(plan);
    throw error;
  }

  private async runAfterPublishSuccess(plan: PublishPlan) {
    await runPublishHook({
      status: 'afterPublish',
      plan,
      result: 'success',
    });
  }
}
