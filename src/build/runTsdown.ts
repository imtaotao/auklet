import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execa } from 'execa';

const require = createRequire(import.meta.url);
const tsdownRunFile = require.resolve('tsdown/run');
const currentExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const defaultConfigFile = fileURLToPath(
  new URL(`./tsdownConfig.${currentExtension}`, import.meta.url),
);

export function hasTsdownConfigArg(args: Array<string>) {
  return args.some(
    (arg, index) =>
      arg === '--no-config' ||
      arg === '-c' ||
      arg === '--config' ||
      arg.startsWith('--config=') ||
      args[index - 1] === '-c' ||
      args[index - 1] === '--config',
  );
}

export type RunTsdownOptions = {
  cwd?: string;
  env?: Record<string, string>;
};

export function createTsdownArgs(args: Array<string>) {
  const tsdownArgs = hasTsdownConfigArg(args)
    ? args
    : ['--config', defaultConfigFile, ...args];
  return [tsdownRunFile, ...tsdownArgs];
}

export async function runTsdown(
  args: Array<string>,
  options: RunTsdownOptions = {},
) {
  const tsdownArgs = createTsdownArgs(args);
  const result = await execa(process.execPath, tsdownArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
    stdio: 'inherit',
    reject: false,
  });

  return result.exitCode ?? 0;
}
