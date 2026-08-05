import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { normalizeAukletConfig } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { StyleModuleEntryPlanner } from '#auklet/css/core/styleModuleEntryPlanner';
import type { AukletConfig } from '#auklet/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('StyleModuleEntryPlanner diagnostics', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-style-planner-');
    project.writePackageJson({ name: '@scope/ui' });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('rejects direct component CSS imports across components', async () => {
    project.writeFile('src/components/Image/index.css', '.image {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/index.css";\n.gallery {}',
    );

    await expect(createPlanner(project)).rejects.toThrow(
      '[css] cross-component CSS import detected: components/ImageGallery/index.css imports components/Image/index.css. Use TSX imports to express component dependencies so auklet can generate module CSS entries correctly.',
    );
  });

  test('rejects direct component CSS imports through local aliases', async () => {
    project.writePackageJson({
      name: '@scope/ui',
      imports: {
        '#styles/*': './src/*.css',
      },
    });
    project.writeFile('src/components/Image/index.css', '.image {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "#styles/components/Image/index";\n.gallery {}',
    );

    await expect(createPlanner(project)).rejects.toThrow(
      '[css] cross-component CSS import detected: components/ImageGallery/index.css imports components/Image/index.css. Use TSX imports to express component dependencies so auklet can generate module CSS entries correctly.',
    );
  });

  test('rejects direct component CSS imports to non-index style files', async () => {
    project.writeFile('src/components/Image/base.css', '.image-base {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/base.css";\n.gallery {}',
    );

    await expect(createPlanner(project)).rejects.toThrow(
      '[css] cross-component CSS import detected: components/ImageGallery/index.css imports components/Image/base.css. Use TSX imports to express component dependencies so auklet can generate module CSS entries correctly.',
    );
  });

  test('allows direct component CSS imports when module output is disabled', async () => {
    project.writeFile('src/components/Image/index.css', '.image {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/index.css";\n.gallery {}',
    );

    await expect(
      createPlanner(project, { modules: false }),
    ).resolves.toBeDefined();
  });

  test('allows same-component local CSS imports', async () => {
    project.writeFile('src/components/Image/base.css', '.image-base {}');
    project.writeFile(
      'src/components/Image/index.css',
      '@import "./base.css";\n.image {}',
    );

    await expect(createPlanner(project)).resolves.toBeDefined();
  });

  test('allows direct imports to configured same-package shared CSS', async () => {
    project.writeFile(
      'src/internal/syntaxHighlight.css',
      '.syntax-highlight {}',
    );
    project.writeFile(
      'src/components/CodeBlock/index.css',
      '@import "../../internal/syntaxHighlight.css";\n.code-block {}',
    );

    await expect(
      createPlanner(project, {
        styles: {
          shared: ['./src/internal/**/*.css'],
        },
      }),
    ).resolves.toBeDefined();
  });

  test('rejects relative CSS imports outside the current source root', async () => {
    project.writeFile('outside.css', '.outside {}');
    project.writeFile(
      'src/components/CodeBlock/index.css',
      '@import "../../../outside.css";\n.code-block {}',
    );

    await expect(createPlanner(project)).rejects.toThrow(
      '[css] cross-package CSS import detected: components/CodeBlock/index.css imports',
    );
  });

  test('rejects shared patterns outside the current source root', async () => {
    project.writeFile('shared/syntaxHighlight.css', '.syntax-highlight {}');

    await expect(
      createPlanner(project, {
        styles: {
          shared: './shared/**/*.css',
        },
      }),
    ).rejects.toThrow(
      '[css] styles.shared pattern must resolve under source root: ./shared/**/*.css',
    );
  });

  test('rejects component CSS imported by shared CSS', async () => {
    project.writeFile(
      'src/internal/syntaxHighlight.css',
      '@import "../components/Button/index.css";\n.syntax-highlight {}',
    );
    project.writeFile(
      'src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    project.writeFile('src/components/Button/index.css', '.button {}');

    await expect(
      createPlanner(project, {
        styles: {
          shared: './src/internal/**/*.css',
        },
      }),
    ).rejects.toThrow(
      '[css] shared CSS import must target non-module source CSS: internal/syntaxHighlight.css imports components/Button/index.css.',
    );
  });

  test('rejects theme CSS imported by shared CSS', async () => {
    project.writeFile(
      'src/internal/syntaxHighlight.css',
      '@import "../themes/light.css";\n.syntax-highlight {}',
    );
    project.writeFile('src/themes/light.css', ':root { color-scheme: light; }');

    await expect(
      createPlanner(project, {
        styles: {
          shared: './src/internal/**/*.css',
          themes: {
            light: './src/themes/light.css',
          },
        },
      }),
    ).rejects.toThrow(
      '[css] shared CSS import must target non-module source CSS: internal/syntaxHighlight.css imports themes/light.css.',
    );
  });
});

const createPlanner = async (
  project: VirtualProject,
  options: {
    modules?: boolean;
    styles?: AukletConfig['styles'];
  } = {},
) => {
  const packageContext = new StylePackageContext({
    config: moduleStyleBuildConfig,
    context: {
      packageRoot: project.root,
      sourceDir: 'src',
      outputDir: 'dist',
    },
    normalizedConfig: normalizeAukletConfig({
      source: 'src',
      output: 'dist',
      modules: options.modules ?? true,
      styles: options.styles,
    }),
  });

  return StyleModuleEntryPlanner.create(packageContext);
};
