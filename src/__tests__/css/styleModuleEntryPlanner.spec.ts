import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { normalizeAukletConfig } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { StyleModuleEntryPlanner } from '#auklet/css/core/styleModuleEntryPlanner';
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

  test('rejects direct component CSS imports across components', () => {
    project.writeFile('src/components/Image/index.css', '.image {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/index.css";\n.gallery {}',
    );

    expect(() => createPlanner(project)).toThrow(
      '[css] cross-component CSS import detected: components/ImageGallery/index.css imports components/Image/index.css. Use TSX imports to express component dependencies so auklet can generate module CSS entries correctly.',
    );
  });

  test('rejects direct component CSS imports to non-index style files', () => {
    project.writeFile('src/components/Image/base.css', '.image-base {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/base.css";\n.gallery {}',
    );

    expect(() => createPlanner(project)).toThrow(
      '[css] cross-component CSS import detected: components/ImageGallery/index.css imports components/Image/base.css. Use TSX imports to express component dependencies so auklet can generate module CSS entries correctly.',
    );
  });

  test('allows direct component CSS imports when module output is disabled', () => {
    project.writeFile('src/components/Image/index.css', '.image {}');
    project.writeFile(
      'src/components/ImageGallery/index.css',
      '@import "../Image/index.css";\n.gallery {}',
    );

    expect(() => createPlanner(project, { modules: false })).not.toThrow();
  });

  test('allows same-component local CSS imports', () => {
    project.writeFile('src/components/Image/base.css', '.image-base {}');
    project.writeFile(
      'src/components/Image/index.css',
      '@import "./base.css";\n.image {}',
    );

    expect(() => createPlanner(project)).not.toThrow();
  });
});

const createPlanner = (
  project: VirtualProject,
  options: {
    modules?: boolean;
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
    }),
  });

  return new StyleModuleEntryPlanner(packageContext);
};
