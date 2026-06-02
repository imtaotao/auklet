import { isPlainObject, isString } from 'aidly';
import { execa, type Options } from 'execa';
import semver from 'semver';
import type { WorkspacePackage } from '#auklet/publish/types';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';

const supportedPnpmRange = '>=10.0.0';
type PnpmResult = Awaited<ReturnType<typeof execa>>;

export class NpmPublishAuthenticationError extends Error {
  constructor(readonly packageRoot: string) {
    super('npm publish requires additional authentication.');
  }
}

export class NpmPackageVersionExistsError extends Error {
  constructor(packageName: string, version: string, registry?: string) {
    const location = registry ? ` at ${registry}` : '';
    super(
      `[publish] package ${packageName}@${version}${location} already exists.`,
    );
  }
}

const runPnpm = async (args: Array<string>, options: Options = {}) => {
  const timeout = options.timeout;
  const subprocess = execa('pnpm', args, {
    reject: false,
    ...options,
    timeout: undefined,
  });
  if (!timeout) return subprocess;

  return withPnpmTimeout(subprocess, timeout);
};

export async function withPnpmTimeout(
  subprocess: ReturnType<typeof execa>,
  timeout: number,
) {
  let timeoutId: NodeJS.Timeout | null = null;
  const result = await Promise.race([
    subprocess,
    new Promise<PnpmResult>((resolve) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`pnpm command timed out after ${timeout}ms.`);
        subprocess.kill('SIGKILL', error);
        resolve({
          failed: true,
          timedOut: true,
          exitCode: undefined,
          stdout: '',
          stderr: error.message,
        } as PnpmResult);
      }, timeout);
    }),
  ]);

  if (timeoutId) clearTimeout(timeoutId);
  subprocess.catch(() => {});
  return result;
}

export async function ensurePnpm() {
  const result = await runPnpm(['--version']);
  const stdout = String(result.stdout ?? '');
  if (hasFailedPnpmResult(result) || !stdout) {
    throw new Error(
      '[publish] pnpm is required for publishing.\n' +
        '[publish] Install pnpm first:\n' +
        '  corepack enable\n' +
        '  corepack prepare pnpm@10 --activate',
    );
  }

  const version = stdout.trim();
  if (!semver.satisfies(version, supportedPnpmRange)) {
    throw new Error(
      `[publish] unsupported pnpm version: ${version}\n` +
        `[publish] expected pnpm ${supportedPnpmRange}`,
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
    throw new Error('[publish] failed to read pnpm workspace packages.', {
      cause: error,
    });
  }
}

export async function runPnpmBuild(packageRoot: string) {
  const result = await runPnpm(['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (hasFailedPnpmResult(result)) {
    throw new Error(`[publish] build failed at ${packageRoot}.`);
  }
}

export async function runPnpmPublish(
  packageRoot: string,
  args: Array<string>,
  options: { token?: string } = {},
) {
  const isDryRun = args.includes('--dry-run');
  const result = await runPnpm(['publish', ...args], {
    cwd: packageRoot,
    env: createPnpmAuthEnv(options.token),
    stdio: isDryRun ? 'pipe' : 'inherit',
  });
  if (isDryRun) writeProcessOutput(result);
  if (hasFailedPnpmResult(result)) {
    if (hasNpmAuthChallenge(result)) {
      throw new NpmPublishAuthenticationError(packageRoot);
    }
    throw new Error('pnpm publish failed.');
  }
}

export async function runPnpmWhoami(
  packageRoot: string,
  options: {
    packageName?: string;
    registry?: string;
    timeout?: number;
    token?: string;
  } = {},
) {
  const args = ['whoami'];
  if (options.registry) args.push('--registry', options.registry);

  const result = await runPnpm(args, {
    cwd: packageRoot,
    env: createPnpmAuthEnv(options.token),
    timeout: options.timeout,
  });
  if (hasFailedPnpmResult(result)) {
    const target = options.packageName ? ` for ${options.packageName}` : '';
    const registry = options.registry ? ` at ${options.registry}` : '';
    const reason = getPnpmFailureReason(result);
    throw new Error(
      `[publish] npm authentication is required${target}${registry} before publishing.\n` +
        '[publish] Run `pnpm login` or configure an npm token before retrying.' +
        (reason ? `\n[publish] Reason: ${reason}` : ''),
    );
  }

  return String(result.stdout ?? '').trim();
}

export async function hasPublishedPackageVersion(
  packageRoot: string,
  packageName: string,
  version: string,
  options: { registry?: string; timeout?: number; token?: string } = {},
) {
  const args = ['view', `${packageName}@${version}`, 'version'];
  if (options.registry) args.push('--registry', options.registry);

  const result = await runPnpm(args, {
    cwd: packageRoot,
    env: createPnpmAuthEnv(options.token),
    timeout: options.timeout,
  });
  if (!hasFailedPnpmResult(result)) {
    return String(result.stdout ?? '').trim() === version;
  }
  if (isPackageNotFound(result)) return false;

  const reason = getPnpmFailureReason(result);
  throw new Error(
    `[publish] failed to check published version for ${packageName}@${version}.` +
      (reason ? `\n[publish] Reason: ${reason}` : ''),
  );
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
  if (hasFailedPnpmResult(result)) {
    throw new Error(
      `[publish] pnpm owner add failed for ${user} -> ${packageName}.`,
    );
  }
}

export function createPnpmAuthEnv(token?: string) {
  if (!token) return undefined;
  return {
    NODE_AUTH_TOKEN: token,
    NPM_TOKEN: token,
  };
}

const isWorkspacePackage = (value: unknown): value is WorkspacePackage => {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isString(value.name) &&
    value.name.length > 0 &&
    isString(value.path) &&
    value.path.length > 0 &&
    isString(value.version) &&
    value.version.length > 0 &&
    (value.private === undefined || typeof value.private === 'boolean')
  );
};

const hasFailedPnpmResult = (result: {
  failed?: boolean;
  exitCode?: unknown;
}) => {
  return result.failed === true || result.exitCode !== 0;
};

const getPnpmFailureReason = (result: {
  stdout?: unknown;
  stderr?: unknown;
}) => {
  const stderr = String(result.stderr ?? '').trim();
  if (stderr) return stderr;

  const stdout = String(result.stdout ?? '').trim();
  return stdout || null;
};

function throwInvalidWorkspacePackages(): never {
  throw new Error(
    '[publish] failed to read pnpm workspace packages.\n' +
      '[publish] Expected `pnpm list -r --depth -1 --json` to return package objects with name/path/version.',
  );
}

export function hasNpmAuthChallenge(result: {
  stdout?: unknown;
  stderr?: unknown;
}) {
  const output = [result.stdout, result.stderr]
    .map((value) => String(value ?? ''))
    .join('\n');
  return isNpmAuthChallenge(output);
}

const writeProcessOutput = (result: { stdout?: unknown; stderr?: unknown }) => {
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');

  if (stdout) process.stdout.write(withTrailingLineBreak(stdout));
  if (stderr) process.stderr.write(withTrailingLineBreak(stderr));
};

const withTrailingLineBreak = (value: string) => {
  return value.endsWith('\n') ? value : `${value}\n`;
};

const isNpmAuthChallenge = (output: string) => {
  return [
    'Authenticate your account',
    'one-time password',
    'OTP',
    'EOTP',
    'ENEEDAUTH',
  ].some((text) => output.includes(text));
};

const isPackageNotFound = (result: { stdout?: unknown; stderr?: unknown }) => {
  const output = [result.stdout, result.stderr]
    .map((value) => String(value ?? ''))
    .join('\n');
  return [
    'E404',
    '404 Not Found',
    'is not in this registry',
    'No match found for version',
  ].some((text) => output.includes(text));
};
