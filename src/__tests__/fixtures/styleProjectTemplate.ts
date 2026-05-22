import path from 'node:path';
import { createVirtualProject, type VirtualProject } from './virtualProject';

const packageName = '@fixture/app';
const sourceDir = 'source';
const outputDir = 'output';
const packageDirectory = 'packages/app';

export type StyleProjectTemplate = {
  project: VirtualProject;
  workspaceRoot: string;
  packageRoot: string;
  packageName: string;
  outputDir: string;
  sourceDir: string;
  writeStyle: (relativePath: string, content: string) => string;
  readOutput: (relativePath: string) => string;
  outputFiles: () => Array<string>;
};

const createAukletConfig = () => `
  export const config = {
    source: '${sourceDir}',
    output: '${outputDir}',
    styles: {
      themes: {
        light: './${sourceDir}/themes/light.css',
        dark: './${sourceDir}/themes/dark.css',
      },
      dependencies: {
        '@scope/theme': {
          entry: '/style.css',
          themes: {
            light: '/themes/light.css',
            dark: '/themes/dark.css',
          },
        },
        '@scope/ui': {
          entry: '/style.css',
          components: ['/components/**.css'],
        },
      },
    },
    modules: true,
  };
`;

export function createStyleProject() {
  const project = createVirtualProject('auklet-style-project-');
  const packageRoot = path.join(project.root, packageDirectory);
  const fromPackageRoot = (relativePath: string) => {
    return path.join(packageDirectory, relativePath);
  };

  project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  project.writeJson(fromPackageRoot('package.json'), {
    name: packageName,
    imports: {
      '#fixture/*': './source/*.js',
    },
  });
  project.writeFile(fromPackageRoot('auklet.config.ts'), createAukletConfig());

  project.writeFiles({
    [fromPackageRoot('node_modules/@scope/theme/style.css')]: `
      @import "./tokens.css";
      .external-theme { color: blue; }
    `,
    [fromPackageRoot('node_modules/@scope/theme/tokens.css')]:
      '.external-token { color: green; }',

    [fromPackageRoot('node_modules/@scope/theme/themes/light.css')]:
      '.external-theme-light { color: white; }',

    [fromPackageRoot('node_modules/@scope/theme/themes/dark.css')]:
      '.external-theme-dark { color: black; }',

    [fromPackageRoot('node_modules/@scope/ui/style.css')]:
      '.external-ui { display: block; }',

    [fromPackageRoot('node_modules/@scope/ui/components/Button.css')]:
      '.external-button { border: 0; }',

    [fromPackageRoot('node_modules/@scope/ui/components/Callout.css')]:
      '.external-callout { padding: 8px; }',

    [fromPackageRoot(`${sourceDir}/themes/light.css`)]:
      ':root { --color: white; }',

    [fromPackageRoot(`${sourceDir}/themes/dark.css`)]:
      ':root[data-theme="dark"] { --color: black; }',

    [fromPackageRoot(`${sourceDir}/components/Button/index.tsx`)]:
      'export function Button() { return null; }',

    [fromPackageRoot(`${sourceDir}/components/Button/index.css`)]:
      '.button { color: green; }',

    [fromPackageRoot(`${sourceDir}/components/Card/index.tsx`)]: `
      import { Button } from '#fixture/components/Button';
      import { Button as ExternalButton } from '@scope/ui';
      import { Callout } from '@scope/ui/components/Callout';
      export function Card() { return Button ?? ExternalButton ?? Callout ?? null; }
    `,

    [fromPackageRoot(`${sourceDir}/components/Card/index.css`)]: `
      @import "./tokens.css";
      .card { color: red; }
    `,

    [fromPackageRoot(`${sourceDir}/components/Card/tokens.css`)]:
      '.card-token { margin: 0; }',
  });

  const writeStyle = (relativePath: string, content: string) => {
    return project.writeFile(fromPackageRoot(relativePath), content);
  };

  const readOutput = (relativePath: string) => {
    return project.readFile(
      fromPackageRoot(path.join(outputDir, relativePath)),
    );
  };

  const outputFiles = () => {
    return project.listFiles(fromPackageRoot(outputDir));
  };

  return {
    project,
    workspaceRoot: project.root,
    packageRoot,
    packageName,
    outputDir,
    sourceDir,
    writeStyle,
    readOutput,
    outputFiles,
  } satisfies StyleProjectTemplate;
}
