import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

export function createTsdownProject() {
  const project = createVirtualProject('auklet-tsdown-');

  project.writePackageJson({
    name: '@scope/fixture-package',
    version: '1.2.3',
    author: 'tester',
    dependencies: {
      aidly: '^1.0.0',
    },
    optionalDependencies: {
      kleur: '^4.0.0',
    },
    devDependencies: {
      '@scope/dev-tool': '^1.0.0',
    },
    peerDependencies: {
      react: '^19.0.0',
    },
  });
  project.writeFile('tsconfig.package.json', '{}');

  return project;
}

export function writeModuleEntries(project: VirtualProject) {
  project.writeFiles({
    'src/index.ts': 'export const value = 1;',
    'src/components/Button/index.tsx':
      'export function Button() { return null; }',
    'src/components/Button/index.spec.tsx': 'export const ignored = true;',
    'src/types.d.ts': 'export type Ignored = string;',
    'src/__tests__/fixture.ts': 'export const ignored = true;',
  });
}
