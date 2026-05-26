import fs from 'node:fs';
import path from 'node:path';
import { isString } from 'aidly';
import type { PackageJson } from '#auklet/publish/types';

const packageJsonFile = 'package.json';

export function getPackageJsonPath(packageRoot: string) {
  return path.join(packageRoot, packageJsonFile);
}

export function readPackageJson(packageRoot: string) {
  const filePath = getPackageJsonPath(packageRoot);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson;
  } catch (error) {
    throw new Error(`[publish] failed to read package.json at ${filePath}.`, {
      cause: error,
    });
  }
}

export function writePackageJson(
  packageRoot: string,
  packageJson: PackageJson,
) {
  const filePath = getPackageJsonPath(packageRoot);
  fs.writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

export function requirePackageName(
  packageRoot: string,
  packageJson: PackageJson,
) {
  if (isString(packageJson.name) && packageJson.name) {
    return packageJson.name;
  }
  throw new Error(`[publish] package.json#name is required at ${packageRoot}.`);
}

export function requirePackageVersion(
  packageRoot: string,
  packageJson: PackageJson,
) {
  if (isString(packageJson.version) && packageJson.version) {
    return packageJson.version;
  }
  throw new Error(
    `[publish] package.json#version is required at ${packageRoot}.`,
  );
}

export function getPublishConfig(packageJson: PackageJson) {
  return packageJson.auklet?.publish ?? {};
}
