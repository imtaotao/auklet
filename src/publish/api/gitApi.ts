import { execa } from 'execa';
import type { AukletLogger } from '#auklet/logger';

const runGit = async (args: Array<string>, cwd: string) => {
  return execa('git', args, {
    cwd,
    reject: false,
  });
};

export async function isGitRepository(cwd: string) {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  return !result.exitCode && result.stdout.trim() === 'true';
}

export async function getGitShortHash(cwd: string) {
  const result = await runGit(['rev-parse', '--short=6', 'HEAD'], cwd);
  if (result.exitCode) return null;
  return result.stdout.trim() || null;
}

export async function ensureGitClean(cwd: string) {
  const result = await runGit(['status', '--porcelain'], cwd);
  if (result.exitCode) {
    throw new Error('[auklet:publish] failed to check git status.');
  }
  if (result.stdout.trim()) {
    throw new Error(
      '[auklet:publish] git working tree must be clean before publishing.',
    );
  }
}

export async function hasGitChanges(cwd: string) {
  const result = await runGit(['status', '--porcelain'], cwd);
  if (result.exitCode) {
    throw new Error('[auklet:publish] failed to check git status.');
  }
  return Boolean(result.stdout.trim());
}

export async function commitRelease(cwd: string, version: string) {
  const addResult = await runGit(['add', '-A'], cwd);
  if (addResult.exitCode) {
    throw new Error('[auklet:publish] failed to stage release changes.');
  }

  const commitResult = await runGit(
    ['commit', '-m', `release: ${version}`],
    cwd,
  );
  if (commitResult.exitCode) {
    throw new Error('[auklet:publish] failed to commit release changes.');
  }
}

export async function createVersionTag(
  cwd: string,
  version: string,
  logger: AukletLogger,
) {
  const tagName = `v${version}`;
  const exists = await runGit(['rev-parse', '--verify', tagName], cwd);
  if (!exists.exitCode) {
    logger.warnOnce(
      'git tag ',
      logger.version(tagName),
      ' already exists, skipping tag creation.',
    );
    return;
  }

  const result = await runGit(['tag', tagName], cwd);
  if (result.exitCode) {
    throw new Error(`[auklet:publish] failed to create git tag ${tagName}.`);
  }
}
