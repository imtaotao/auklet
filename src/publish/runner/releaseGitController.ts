import {
  commitRelease,
  createVersionTag,
  ensureGitClean,
  hasGitChanges,
  isGitRepository,
} from '#auklet/publish/api/gitApi';
import type { PublishOptions, PublishPlan } from '#auklet/publish/types';

export class ReleaseGitController {
  constructor(private readonly options: PublishOptions) {}

  async checkBeforePublish(plan: PublishPlan) {
    const git = await isGitRepository(plan.root);
    if (plan.dryRun || !git) return;

    if (this.options.allowDirty) {
      console.warn(
        '[auklet:publish] --allow-dirty enabled, skipping git clean check, commit, and tag.',
      );
      return;
    }

    await ensureGitClean(plan.root);
  }

  async commitAndTag(plan: PublishPlan) {
    const git = await isGitRepository(plan.root);
    if (git && this.options.allowDirty) {
      console.warn(
        '[auklet:publish] --allow-dirty enabled, skipping git commit and tag.',
      );
      return;
    }

    if (!git) {
      console.warn(
        '[auklet:publish] git repository not found, skipping commit and tag.',
      );
      return;
    }

    const changed = await hasGitChanges(plan.root);

    if (changed) {
      if (!this.options.version) {
        throw new Error(
          '[auklet:publish] build or format changed files. Commit changes before publishing without --version.',
        );
      }
      await commitRelease(plan.root, plan.version);
    }

    await createVersionTag(plan.root, plan.version);
  }
}
