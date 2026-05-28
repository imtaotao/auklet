import { createScopedAukletLogger } from '#auklet/logger';
import { runPublishHook } from '#auklet/publish/api/publishHookApi';
import {
  runPackageBuilds,
  validateBuildScript,
} from '#auklet/publish/runner/packageBuilder';
import { formatPublishOutputs } from '#auklet/publish/runner/publishOutputFormatter';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import { PackagePublisher } from '#auklet/publish/runner/packagePublisher';
import { reportPublishFailure } from '#auklet/publish/runner/publishFailureReporter';
import { reportPublishSummary } from '#auklet/publish/runner/publishSummaryReporter';
import { PublishPreflight } from '#auklet/publish/runner/publishPreflight';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';
import { ReleaseGitController } from '#auklet/publish/runner/releaseGitController';
import { VersionWriter } from '#auklet/publish/runner/versionWriter';
import type { AukletLogger } from '#auklet/logger';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class PublishRunner {
  private readonly git: ReleaseGitController;
  private readonly publisher: PackagePublisher;
  private readonly preflight: PublishPreflight;
  private readonly versions: VersionWriter;
  private readonly logger: AukletLogger;

  private readonly options: PublishOptions;

  constructor(options: PublishOptions) {
    this.options = options;
    this.logger = createScopedAukletLogger('publish');
    this.git = new ReleaseGitController(this.options, this.logger);
    this.publisher = new PackagePublisher(this.options, this.logger);
    this.preflight = new PublishPreflight(this.options, this.logger);
    this.versions = new VersionWriter(this.options, this.logger);
  }

  async run() {
    const plan = await resolvePublishPlan(this.options, this.logger);
    let failureHookEnabled = false;

    try {
      validateBuildScript(plan.targets);
      await this.git.checkBeforePublish(plan);
      await this.preflight.verifyBeforeBuild(plan);
      this.versions.logDryRunPlan(plan);
      await runPublishHook({ status: 'beforeBuild', plan });
      failureHookEnabled = true;
      this.versions.writeBeforeBuild(plan);
      await runPackageBuilds(plan.targets, this.logger);
      await runPublishHook({ status: 'afterBuild', plan });
      await formatPublishOutputs(plan.targets, this.options.format);
      await runPublishHook({ status: 'beforePublish', plan });
      await this.publishWithPlan(plan);
    } catch (error) {
      if (!failureHookEnabled) {
        reportPublishSummary({
          plan,
          status: 'failure',
          error,
        });
        throw error;
      }
      await this.handleFailure(plan, error);
    }

    await this.runAfterPublishSuccess(plan);
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
      error instanceof PublishTargetError ? error.target : null;
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
      this.logger.error?.(hookError);
    }

    if (error instanceof PublishTargetError) {
      reportPublishFailure(error, plan.version);
    }
    reportPublishSummary({
      plan,
      status: 'failure',
      error,
    });
    this.versions.logWrittenVersionFailure(plan);
    throw error;
  }

  private async runAfterPublishSuccess(plan: PublishPlan) {
    await runPublishHook({
      status: 'afterPublish',
      plan,
      result: 'success',
    });
    reportPublishSummary({
      plan,
      status: 'success',
      error: null,
    });
  }
}
