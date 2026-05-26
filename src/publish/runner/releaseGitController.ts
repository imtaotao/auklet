import {
  commitRelease,
  createVersionTag,
  ensureGitClean,
  hasGitChanges,
  isGitRepository,
} from '#auklet/publish/api/gitApi';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';
import type { AukletLogger } from '#auklet/logger';

export class ReleaseGitController {
  constructor(
    private readonly options: PublishOptions,
    private readonly logger: AukletLogger,
  ) {}

  async checkBeforePublish(plan: PublishPlan) {
    const git = await isGitRepository(plan.root);
    if (plan.dryRun || !git) return;

    if (this.options.allowDirty) {
      this.warnOnce(
        '--allow-dirty enabled, skipping git clean check, commit, and tag.',
      );
      return;
    }

    await ensureGitClean(plan.root);
  }

  async commitAndTag(plan: PublishPlan) {
    const git = await isGitRepository(plan.root);
    if (git && this.options.allowDirty) {
      this.warnOnce('--allow-dirty enabled, skipping git commit and tag.');
      return;
    }

    if (!git) {
      this.warnOnce('git repository not found, skipping commit and tag.');
      return;
    }

    const changed = await hasGitChanges(plan.root);

    if (changed) {
      if (!this.options.version) {
        throw new Error(
          '[publish] build or format changed files. Commit changes before publishing without --version.',
        );
      }
      await commitRelease(plan.root, plan.version);
    }

    await createVersionTag(plan.root, plan.version, this.logger);
  }

  private warnOnce(content: string) {
    this.logger.warnOnce(content);
  }
}
