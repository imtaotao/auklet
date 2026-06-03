import { AukletEnvContext } from '#auklet/env';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { PublishRunner } from '#auklet/publish/publishRunner';
import { validateNpmrcAuthEnv } from '#auklet/publish/api/npmrc';
import { createPublishRootEnv } from '#auklet/publish/publishEnv';
import { findWorkspaceRoot } from '#auklet/workspace/root';
import { parseOwnerCommand } from '#auklet/cli/parse/owner';
import { parsePublishCommand } from '#auklet/cli/parse/publish';

export async function runPublishCli(args: Array<string>) {
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const envContext = new AukletEnvContext(cwd, root);

  await envContext.run(async () => {
    const runtime = { envContext };
    const options = parsePublishCommand(args, { cwd, envContext });
    const { env } = createPublishRootEnv(options, runtime);
    validatePublishCliNpmrcAuthEnv(options.cwd, env);
    await ensurePnpm({ env });
    await new PublishRunner(options, runtime).run();
  });
}

export async function runOwnerCli(args: Array<string>) {
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const envContext = new AukletEnvContext(cwd, root);

  await envContext.run(async () => {
    const options = parseOwnerCommand(args, { cwd, envContext });
    const env = envContext.values;
    validatePublishCliNpmrcAuthEnv(cwd, env);
    await ensurePnpm({ env: envContext.normalizedValues });
    await new OwnerRunner(options).run();
  });
}

const validatePublishCliNpmrcAuthEnv = (
  cwd: string,
  env?: Record<string, string | undefined>,
) => {
  validateNpmrcAuthEnv(cwd, findWorkspaceRoot(cwd) ?? cwd, { env });
};
