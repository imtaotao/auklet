import { createAukletLogger, type AukletLogger } from '#auklet/logger';
import type { PublishPlan, PublishTarget } from '#auklet/publish/types';
import { PublishTargetError } from '#auklet/publish/runner/publishTargetError';

type PublishSummaryStatus = 'success' | 'failure';
type VersionChangeTaskStatus = 'success' | 'error' | 'skipped';

export type PublishSummaryOptions = {
  plan: PublishPlan;
  status: PublishSummaryStatus;
  error: unknown | null;
};

export function reportPublishSummary(options: PublishSummaryOptions) {
  new PublishSummaryReporter(options).report();
}

export class PublishSummaryReporter {
  private readonly logger: AukletLogger;

  private publishedCount = 0;
  private failedTarget: PublishTarget | null;
  private publishError: PublishTargetError | null;
  private publishedTargets: Array<PublishTarget> = [];
  private publishedTargetRoots = new Set<string>();

  constructor(private readonly options: PublishSummaryOptions) {
    this.logger = createAukletLogger();
    this.publishError =
      options.error instanceof PublishTargetError ? options.error : null;

    this.publishedTargets = this.publishError
      ? this.publishError.publishedTargets
      : [];
    this.failedTarget = this.publishError ? this.publishError.target : null;

    this.publishedTargetRoots = new Set(
      this.publishedTargets.map((target) => this.getTargetKey(target)),
    );
    this.publishedCount =
      options.status === 'success' && !options.plan.dryRun
        ? options.plan.targets.length
        : this.publishedTargets.length;
  }

  report() {
    this.logger.newline();
    this.logger.raw(this.logger.colors.gray('-'.repeat(56)));
    this.logger.newline();

    this.logger.result({
      title: this.logger.colors.bold(this.getSummaryTitle()),
      status: this.options.status === 'success' ? 'success' : 'error',
      body: this.getSummaryBody(),
      details: this.getSummaryDetails(),
    });

    this.logger.newline();

    this.logger.tasks({
      tasks: this.getVersionChangeTasks(),
    });

    this.logger.newline();
  }

  private getSummaryTitle() {
    if (this.options.status === 'failure') return 'Publish failed';
    return this.options.plan.dryRun
      ? 'Publish dry-run complete'
      : 'Publish complete';
  }

  private getSummaryBody() {
    if (this.options.status === 'success') {
      return [
        this.options.plan.dryRun
          ? 'Preflight completed without publishing packages.'
          : 'All selected packages were published.',
      ];
    }

    if (this.failedTarget) {
      return [
        ['Failed at ', this.logger.package(this.failedTarget.packageName), '.'],
        ...this.getFailureReasonLine(),
      ];
    }

    return [
      'Publish stopped before package publishing completed.',
      ...this.getFailureReasonLine(),
    ];
  }

  private getFailureReasonLine() {
    const message = this.getFailureMessage();
    if (!message) return [];
    return [
      [this.logger.colors.bold(this.logger.colors.red(`Reason: ${message}`))],
    ];
  }

  private getFailureMessage() {
    const error = this.publishError
      ? this.publishError.originalError
      : this.options.error;
    return error instanceof Error ? error.message : null;
  }

  private getSummaryDetails() {
    return {
      mode: this.formatSummaryValue(
        this.options.plan.dryRun ? 'dry-run' : 'publish',
      ),
      packages: this.formatSummaryValue(this.options.plan.targets.length),
      published: this.formatSummaryValue(this.publishedCount),
      version: this.logger.version(this.options.plan.version),
    };
  }

  private getVersionChangeTasks() {
    return this.options.plan.targets.map((target) => ({
      title: [
        this.logger.package(target.packageName),
        ' ',
        ...this.formatVersionChange(target.version, target.publishVersion),
      ],
      status: this.getVersionChangeTaskStatus(target),
    }));
  }

  private getVersionChangeTaskStatus(
    target: PublishTarget,
  ): VersionChangeTaskStatus {
    if (this.options.plan.dryRun) return 'skipped';
    if (this.options.status === 'success') return 'success';
    if (
      this.failedTarget &&
      this.getTargetKey(target) === this.getTargetKey(this.failedTarget)
    ) {
      return 'error';
    }
    if (this.publishedTargetRoots.has(this.getTargetKey(target))) {
      return 'success';
    }
    return 'skipped';
  }

  private getTargetKey(target: PublishTarget) {
    return `${target.packageRoot}:${target.packageName}`;
  }

  private formatVersionChange(from: string, to: string) {
    return [
      this.logger.version(from),
      this.logger.colors.gray(' -> '),
      this.logger.version(to),
    ];
  }

  private formatSummaryValue(value: string | number) {
    return this.logger.colors.bold(this.logger.colors.cyan(String(value)));
  }
}
