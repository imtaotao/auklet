import path from 'node:path';
import type { PublishTarget } from '#auklet/publish/types';

export type PublishPhase = 'preflight' | 'publish';

export class PublishTargetError extends Error {
  constructor(
    readonly target: PublishTarget,
    readonly phase: PublishPhase,
    readonly originalError: unknown,
    readonly publishedTargets: Array<PublishTarget>,
  ) {
    super(
      `${phase} failed for ${target.packageName} at ${path.relative(process.cwd(), target.packageRoot) || target.packageRoot}.`,
    );
  }
}
