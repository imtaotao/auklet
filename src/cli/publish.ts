import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';

export async function runPublish(args: Array<string>) {
  await runPublishCli(args);
  return 0;
}

export async function runOwner(args: Array<string>) {
  await runOwnerCli(args);
  return 0;
}
