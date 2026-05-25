import semver from 'semver';
import { getGitShortHash } from '#auklet/publish/api/gitApi';

const prereleaseKinds = new Set(['alpha', 'beta']);
const releaseIncrements = new Set(['patch', 'minor', 'major']);

export async function resolvePublishVersion(
  currentVersion: string,
  versionSpec: string | undefined,
  cwd: string,
) {
  if (!versionSpec) {
    if (!semver.valid(currentVersion)) {
      throw new Error(
        `[auklet:publish] invalid package version: ${currentVersion}`,
      );
    }
    return currentVersion;
  }

  if (releaseIncrements.has(versionSpec)) {
    const parsed = semver.parse(currentVersion);
    if (!parsed) {
      throw new Error(
        `[auklet:publish] invalid package version: ${currentVersion}`,
      );
    }
    const baseVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    const next = semver.inc(baseVersion, versionSpec as semver.ReleaseType);

    if (!next) {
      throw new Error(
        `[auklet:publish] failed to bump version ${currentVersion} with ${versionSpec}.`,
      );
    }
    return next;
  }

  if (prereleaseKinds.has(versionSpec)) {
    const parsed = semver.parse(currentVersion);
    if (!parsed) {
      throw new Error(
        `[auklet:publish] invalid package version: ${currentVersion}`,
      );
    }
    const suffix = (await getGitShortHash(cwd)) ?? createTimestamp();
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-${versionSpec}.${suffix}`;
  }

  const explicit = semver.valid(versionSpec);
  if (explicit) return explicit;

  throw new Error(
    `[auklet:publish] unsupported --version value: ${versionSpec}`,
  );
}

export function validateVersionConsistency(
  expectedVersion: string,
  versions: Array<{ packageName: string; version: string }>,
) {
  for (const item of versions) {
    if (item.version !== expectedVersion) {
      throw new Error(
        `[auklet:publish] package ${item.packageName} version ${item.version} does not match shared version ${expectedVersion}.`,
      );
    }
  }
}

const createTimestamp = () => {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
};
