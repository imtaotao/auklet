import type { CAC, Command } from 'cac';

// Help metadata only. Parsing behavior lives in src/cli/parse/*.
type HelpOption = readonly [flags: string, description: string];

export const buildOverrideOptions = [
  ['--source <dir>', 'Source directory'],
  ['--output <dir>', 'Output directory'],
  ['--modules [value]', 'Enable unbundled module output'],
  ['--no-modules', 'Disable unbundled module output'],
  [
    '--build.formats <formats>',
    'Comma-separated cjs, esm, and/or iife formats',
  ],
  ['--build.target <target>', 'JavaScript target passed to tsdown'],
  ['--build.platform <platform>', 'node, neutral, or browser'],
  ['--build.tsconfig <file>', 'TypeScript config file'],
] satisfies Array<HelpOption>;

export const workspaceOptions = [
  ['--filter <pattern>', 'Select workspace packages by package name'],
  ['--workspace', "Alias for --filter '*'"],
  ['--private [value]', 'Include private workspace packages'],
  ['--deps [value]', "Include selected packages' workspace dependencies"],
] satisfies Array<HelpOption>;

export const publishOptions = [
  ['--filter <pattern>', 'Select workspace packages by package name'],
  ['--workspace', "Alias for --filter '*'"],
  ['--version <value>', 'Publish version or version bump'],
  ['--dry-run [value]', 'Validate without writing git or registry state'],
  ['--format [value]', 'Enable publish output formatter'],
  ['--no-format', 'Disable publish output formatter'],
  ['--git [value]', 'Create release commit and tag'],
  ['--no-git', 'Skip release commit and tag'],
  ['--allow-dirty [value]', 'Allow publishing from a dirty worktree'],
  ['--ignore-scripts [value]', 'Skip publish lifecycle hooks'],
  ['--otp <code>', 'Forward an npm 2FA one-time password'],
  ['--token <value>', 'Set NODE_AUTH_TOKEN and NPM_TOKEN for subprocesses'],
] satisfies Array<HelpOption>;

export const ownerOptions = [
  ['--filter <pattern>', 'Add owners to matching workspace packages'],
  ['--package <name>', 'Add owners to explicit npm packages'],
  ['--otp <code>', 'Forward an npm owner-management 2FA code'],
] satisfies Array<HelpOption>;

export const inspectPublishOptions = [
  ['--filter <pattern>', 'Select workspace packages by package name'],
  ['--workspace', "Alias for --filter '*'"],
  ['--version <value>', 'Publish version or version bump'],
  ['--dry-run [value]', 'Preview dry-run publish behavior'],
  ['--otp <code>', 'Forward an npm 2FA one-time password'],
  ['--token <value>', 'Set NODE_AUTH_TOKEN and NPM_TOKEN for subprocesses'],
] satisfies Array<HelpOption>;

export const inspectPackOptions = [
  ['--filter <pattern>', 'Select workspace packages by package name'],
  ['--workspace', "Alias for --filter '*'"],
] satisfies Array<HelpOption>;

export const inspectCssOptions = [
  ['--source <dir>', 'CSS inspect source directory'],
  ['--output <dir>', 'CSS inspect output directory'],
  ['--modules [value]', 'Enable CSS inspect module output'],
  ['--no-modules', 'Disable CSS inspect module output'],
] satisfies Array<HelpOption>;

export const inspectOptions = [
  ...inspectPublishOptions,
  ...inspectPackOptions,
  ...inspectCssOptions,
].filter((option, index, options) => {
  // First matching flag wins; keep shared inspect flag descriptions aligned.
  return options.findIndex(([flags]) => flags === option[0]) === index;
});

export const commandHelpOptions = {
  buildOverrides: buildOverrideOptions,
  inspect: inspectOptions,
  inspectCss: inspectCssOptions,
  inspectPack: inspectPackOptions,
  inspectPublish: inspectPublishOptions,
  owner: ownerOptions,
  publish: publishOptions,
  workspace: workspaceOptions,
};

export function addCommandOptions(
  command: Command,
  options: ReadonlyArray<HelpOption>,
) {
  return options.reduce(
    (currentCommand, [flags, description]) =>
      currentCommand.option(flags, description),
    command,
  );
}

export function createHelpFormatter(cli: CAC) {
  return (sections: Array<{ title?: string; body: string }>) => {
    const command = cli.matchedCommand?.name;
    return sections.map((section) => {
      if (section.title !== 'Options') return section;

      // CAC hides duplicate --version entries, so command-level version flags
      // are patched back into help output here.
      let body = section.body.replace(/\s+\(default: true\)/g, '');
      if (!command) {
        body = addHelpOptionLine(
          body,
          '--version',
          '  -v, --version  Print auklet version',
        );
      }
      if (command === 'publish') {
        body = addHelpOptionLine(
          body,
          '--version',
          '  --version <value>         Publish version or version bump',
        );
      }
      if (command === 'inspect') {
        body = addHelpOptionLine(
          body,
          '--version',
          '  --version <value>   Publish version or version bump',
        );
      }
      return {
        ...section,
        body,
      };
    });
  };
}

const addHelpOptionLine = (body: string, key: string, line: string) => {
  if (body.includes(key)) return body;
  const helpLinePattern = /^  -h, --help/m;
  if (!helpLinePattern.test(body)) return `${body}\n${line}`;
  return body.replace(helpLinePattern, `${line}\n  -h, --help`);
};
