import { execa, execaSync, type Options } from 'execa';
import { isArray, isPlainObject, isString } from 'aidly';

export type WorkspacePackageInfo = {
  name: string;
  path: string;
  version?: string;
  private?: boolean;
};

const pnpmWorkspaceListArgs = ['list', '-r', '--depth', '-1', '--json'];

const parsePnpmWorkspacePackages = (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('[auklet:workspace] failed to parse workspace packages.', {
      cause: error,
    });
  }

  if (!isArray(parsed)) {
    throwInvalidWorkspacePackages();
  }

  return parsed.map((item) => {
    if (!isWorkspacePackageInfo(item)) throwInvalidWorkspacePackages();
    return item;
  });
};

export async function readPnpmWorkspacePackageInfo(
  root: string,
  options: Options = {},
) {
  const result = await execa('pnpm', pnpmWorkspaceListArgs, {
    cwd: root,
    reject: false,
    ...options,
  });
  if (result.failed) {
    throw new Error('[auklet:workspace] failed to read workspace packages.', {
      cause: result.stderr || result.stdout,
    });
  }
  return parsePnpmWorkspacePackages(String(result.stdout ?? ''));
}

export function readPnpmWorkspacePackageInfoSync(root: string) {
  const result = execaSync('pnpm', pnpmWorkspaceListArgs, {
    cwd: root,
    reject: false,
  });
  if (result.failed) {
    throw new Error('[auklet:workspace] failed to read workspace packages.', {
      cause: result.stderr || result.stdout,
    });
  }
  return parsePnpmWorkspacePackages(String(result.stdout ?? ''));
}

const isWorkspacePackageInfo = (
  value: unknown,
): value is WorkspacePackageInfo => {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isString(value.name) &&
    value.name.length > 0 &&
    isString(value.path) &&
    value.path.length > 0 &&
    (value.version === undefined || isString(value.version)) &&
    (value.private === undefined || typeof value.private === 'boolean')
  );
};

function throwInvalidWorkspacePackages(): never {
  throw new Error(
    '[auklet:workspace] failed to read workspace packages.\n' +
      '[auklet:workspace] Expected `pnpm list -r --depth -1 --json` to return package objects with name/path.',
  );
}
