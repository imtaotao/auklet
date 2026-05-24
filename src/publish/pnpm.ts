import { execa, type Options } from 'execa';
import semver from 'semver';
import type { WorkspacePackage } from '#auklet/publish/types';

const supportedPnpmRange = '>=10.0.0';

const runPnpm = async (args: Array<string>, options: Options = {}) => {
  return execa('pnpm', args, {
    reject: false,
    ...options,
  });
};

export async function ensurePnpm() {
  const result = await runPnpm(['--version']);
  const stdout = String(result.stdout ?? '');
  if (result.failed || !stdout) {
    throw new Error(
      [
        '[auklet:publish] pnpm is required for publishing.',
        '[auklet:publish] Install pnpm first:',
        '  corepack enable',
        '  corepack prepare pnpm@10 --activate',
      ].join('\n'),
    );
  }

  const version = stdout.trim();
  if (!semver.satisfies(version, supportedPnpmRange)) {
    throw new Error(
      [
        `[auklet:publish] unsupported pnpm version: ${version}`,
        `[auklet:publish] expected pnpm ${supportedPnpmRange}`,
      ].join('\n'),
    );
  }

  return version;
}

export async function readPnpmWorkspacePackages(root: string) {
  const result = await runPnpm(['list', '-r', '--depth', '-1', '--json'], {
    cwd: root,
  });
  if (result.failed) {
    throw new Error(
      '[auklet:publish] failed to read pnpm workspace packages.',
      { cause: result.stderr || result.stdout },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(result.stdout ?? ''));
  } catch (error) {
    throw new Error(
      '[auklet:publish] failed to parse pnpm workspace package list.',
      { cause: error },
    );
  }

  if (!Array.isArray(parsed)) {
    throwInvalidWorkspacePackages();
  }

  return parsed.map((item) => {
    if (!isWorkspacePackage(item)) throwInvalidWorkspacePackages();
    return item;
  });
}

export async function runPnpmBuild(packageRoot: string) {
  const result = await runPnpm(['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (result.exitCode) {
    throw new Error(`[auklet:publish] build failed at ${packageRoot}.`);
  }
}

export async function runPnpmPublish(packageRoot: string, args: Array<string>) {
  const result = await runPnpm(['publish', ...args], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (result.exitCode) {
    throw new Error(`[auklet:publish] pnpm publish failed at ${packageRoot}.`);
  }
}

export async function runPnpmOwnerAdd(
  packageName: string,
  user: string,
  options: { cwd: string; otp?: string },
) {
  const args = ['owner', 'add', user, packageName];
  if (options.otp) args.push('--otp', options.otp);
  const result = await runPnpm(args, {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  if (result.exitCode) {
    throw new Error(
      `[auklet:publish] pnpm owner add failed for ${user} -> ${packageName}.`,
    );
  }
}

const isWorkspacePackage = (value: unknown): value is WorkspacePackage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    typeof item.path === 'string' &&
    item.path.length > 0 &&
    typeof item.version === 'string' &&
    item.version.length > 0 &&
    (item.private === undefined || typeof item.private === 'boolean')
  );
};

function throwInvalidWorkspacePackages(): never {
  throw new Error(
    [
      '[auklet:publish] failed to read pnpm workspace packages.',
      '[auklet:publish] Expected `pnpm list -r --depth -1 --json` to return package objects with name/path/version.',
    ].join('\n'),
  );
}
