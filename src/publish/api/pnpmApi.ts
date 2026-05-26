import { execa, type Options } from 'execa';
import semver from 'semver';
import type { WorkspacePackage } from '#auklet/publish/types';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';

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
      '[auklet:publish] pnpm is required for publishing.\n' +
        '[auklet:publish] Install pnpm first:\n' +
        '  corepack enable\n' +
        '  corepack prepare pnpm@10 --activate',
    );
  }

  const version = stdout.trim();
  if (!semver.satisfies(version, supportedPnpmRange)) {
    throw new Error(
      `[auklet:publish] unsupported pnpm version: ${version}\n` +
        `[auklet:publish] expected pnpm ${supportedPnpmRange}`,
    );
  }

  return version;
}

export async function readPnpmWorkspacePackages(root: string) {
  try {
    return (await readPnpmWorkspacePackageInfo(root)).map((item) => {
      if (!isWorkspacePackage(item)) throwInvalidWorkspacePackages();
      return item;
    });
  } catch (error) {
    throw new Error(
      '[auklet:publish] failed to read pnpm workspace packages.',
      { cause: error },
    );
  }
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
    '[auklet:publish] failed to read pnpm workspace packages.\n' +
      '[auklet:publish] Expected `pnpm list -r --depth -1 --json` to return package objects with name/path/version.',
  );
}
