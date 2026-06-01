import { runInspectCssCli } from '#auklet/css/inspect';
import { runInspectPublishCli } from '#auklet/publish/inspect';
import { runInspectPackCli } from '#auklet/publish/inspectPack';

export async function runInspect(args: Array<string>) {
  const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
  const [command, ...restArgs] = normalizedArgs;

  if (command === 'css') {
    return runInspectCssCli(restArgs);
  }

  if (command === 'publish') {
    return runInspectPublishCli(restArgs);
  }

  if (command === 'pack') {
    return runInspectPackCli(restArgs);
  }

  if (command) {
    throw new Error(`[inspect] unknown inspect command: ${command}`);
  }

  throw new Error(
    '[inspect] expected inspect command: auk inspect publish, auk inspect pack, or auk inspect css',
  );
}
