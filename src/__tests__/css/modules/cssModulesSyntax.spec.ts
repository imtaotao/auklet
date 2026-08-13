import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import less from 'less';
import { compileCssModule } from '#auklet/css/modules/compileCssModule';
import { createGenerateScopedName } from '#auklet/css/modules/generateScopedName';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('css/modules author syntax', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-syntax-');
    project.writePackageJson({ name: '@scope/fixture', version: '0.0.0' });
  });

  afterEach(() => {
    project.cleanup();
  });

  const scopedName = (localName: string, file: string) =>
    createGenerateScopedName({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    })(localName, file, '');

  const compile = (file: string) =>
    compileCssModule({
      file,
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });

  const renderLess = async (file: string, source: string) => {
    const result = await less.render(source, {
      filename: file,
      paths: [path.dirname(file)],
    });
    return result.css;
  };

  describe('css modules (.module.css)', () => {
    test('keeps kebab-case locals without camelCase aliases', async () => {
      const file = project.writeFile(
        'src/Button.module.css',
        '.foo-bar { color: red; }\n',
      );

      const result = await compile(file);
      const className = scopedName('foo-bar', file);

      expect(result.locals).toEqual({ 'foo-bar': className });
      expect(result.locals).not.toHaveProperty('fooBar');
      expect(result.css).toContain(`.${className}`);
    });

    test('hashes local classes and ids; leaves tag selectors global', async () => {
      const file = project.writeFile(
        'src/IdTag.module.css',
        '#header { color: red; }\ndiv { color: blue; }\n.foo.bar { color: green; }\n',
      );

      const result = await compile(file);
      const header = scopedName('header', file);
      const foo = scopedName('foo', file);
      const bar = scopedName('bar', file);

      expect(result.locals).toEqual({ header, foo, bar });
      expect(result.css).toContain(`#${header}`);
      expect(result.css).toContain(`div { color: blue; }`);
      expect(result.css).toContain(`.${foo}.${bar}`);
    });

    test('treats :global(.theme) as a global class', async () => {
      const file = project.writeFile(
        'src/Button.module.css',
        '.button { color: red; }\n:global(.theme) { color: blue; }\n',
      );

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({ button });
      expect(result.css).toContain(`.${button}`);
      expect(result.css).toContain('.theme { color: blue; }');
      expect(result.css).not.toContain(':global');
    });

    test('keeps mixed local + :global() combinators', async () => {
      const file = project.writeFile(
        'src/Button.module.css',
        '.button :global(.theme) { color: blue; }\n',
      );

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({ button });
      expect(result.css).toContain(`.${button} .theme`);
      expect(result.css).not.toContain(':global');
    });

    test('composes same-file locals into the JS class list', async () => {
      const file = project.writeFile(
        'src/ComposeSame.module.css',
        '.foo { color: red; }\n.bar { composes: foo; background: blue; }\n',
      );

      const result = await compile(file);
      const foo = scopedName('foo', file);
      const bar = scopedName('bar', file);

      expect(result.locals).toEqual({
        foo,
        bar: `${bar} ${foo}`,
      });
      expect(result.css).toContain(`.${foo} { color: red; }`);
      expect(result.css).toContain(`.${bar} { background: blue; }`);
      expect(result.css).not.toContain('composes');
    });

    test('composes locals from another CSS module', async () => {
      const base = project.writeFile(
        'src/base.module.css',
        '.foo { color: red; }\n',
      );
      const file = project.writeFile(
        'src/ComposeFrom.module.css',
        '.bar { composes: foo from "./base.module.css"; background: blue; }\n',
      );

      const result = await compile(file);
      const foo = scopedName('foo', base);
      const bar = scopedName('bar', file);

      expect(result.locals).toEqual({
        bar: `${bar} ${foo}`,
      });
      expect(result.css).toContain(`.${foo} { color: red; }`);
      expect(result.css).toContain(`.${bar} { background: blue; }`);
    });

    test('composes from global keeps the global class name in locals', async () => {
      const file = project.writeFile(
        'src/ComposeGlobal.module.css',
        '.button { composes: btn from global; color: red; }\n',
      );

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({
        button: `${button} btn`,
      });
      expect(result.css).toContain(`.${button} { color: red; }`);
      expect(result.css).not.toContain('.btn');
    });

    test('inlines @value replacements and exports the value on locals', async () => {
      const file = project.writeFile(
        'src/Value.module.css',
        '@value brand: tomato;\n.button { color: brand; }\n',
      );

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({
        brand: 'tomato',
        button,
      });
      expect(result.css).toContain(`color: tomato`);
      expect(result.css).not.toContain('color: brand');
      expect(result.css).not.toContain('@value');
    });

    test('hashes @keyframes names together with animation references', async () => {
      const file = project.writeFile(
        'src/Spin.module.css',
        [
          '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }',
          '.spinner { animation: spin 1s linear infinite; }',
          '',
        ].join('\n'),
      );

      const result = await compile(file);
      const spinner = scopedName('spinner', file);
      const spin = scopedName('spin', file);

      expect(result.locals).toEqual({ spinner, spin });
      expect(result.css).toContain(`@keyframes ${spin}`);
      expect(result.css).toContain(`animation: ${spin} 1s linear infinite`);
      expect(result.css).not.toContain('@keyframes spin ');
      expect(result.css).not.toContain('animation: spin ');
    });
  });

  describe('less then css modules (.module.less)', () => {
    test('passes :global(.theme) through Less, then treats it as global', async () => {
      const source =
        '.button { color: red; }\n:global(.theme) { color: blue; }\n';
      const file = project.writeFile('src/Button.module.less', source);

      expect(await renderLess(file, source)).toContain(':global(.theme)');

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({ button });
      expect(result.css).toContain('.theme');
      expect(result.css).not.toContain(':global');
    });

    test('flattens nested :global blocks to a :global combinator before Modules', async () => {
      const source = `.card {
  :global {
    .theme { color: blue; }
  }
}
`;
      const file = project.writeFile('src/Card.module.less', source);
      const lessCss = await renderLess(file, source);

      expect(lessCss).toContain('.card :global .theme');

      const result = await compile(file);
      const card = scopedName('card', file);

      expect(result.locals).toEqual({ card });
      expect(result.css).toContain(`.${card} .theme`);
      expect(result.css).not.toContain(':global');
    });

    test('flattens a root :global block before Modules', async () => {
      const source = `:global {
  .theme { color: blue; }
}
.local { color: red; }
`;
      const file = project.writeFile('src/Theme.module.less', source);
      const lessCss = await renderLess(file, source);

      expect(lessCss).toContain(':global .theme');

      const result = await compile(file);
      const local = scopedName('local', file);

      expect(result.locals).toEqual({ local });
      expect(result.css).toContain('.theme');
      expect(result.css).toContain(`.${local}`);
      expect(result.css).not.toContain(':global');
    });

    test('keeps &:global(.theme) attached after Less flatten', async () => {
      const source = `.card {
  &:global(.theme) { color: blue; }
}
`;
      const file = project.writeFile('src/Card.module.less', source);
      const lessCss = await renderLess(file, source);

      expect(lessCss).toContain('.card:global(.theme)');

      const result = await compile(file);
      const card = scopedName('card', file);

      expect(result.locals).toEqual({ card });
      expect(result.css).toContain(`.${card}.theme`);
      expect(result.css).not.toContain(':global');
    });

    test('leaves composes intact through Less', async () => {
      const source =
        '.foo { color: red; }\n.bar { composes: foo; background: blue; }\n';
      const file = project.writeFile('src/Compose.module.less', source);
      const lessCss = await renderLess(file, source);

      expect(lessCss).toContain('composes: foo;');

      const result = await compile(file);
      const foo = scopedName('foo', file);
      const bar = scopedName('bar', file);

      expect(result.locals).toEqual({
        foo,
        bar: `${bar} ${foo}`,
      });
      expect(result.css).not.toContain('composes');
    });

    test('leaves @value intact through Less, then inlines it', async () => {
      const source = '@value brand: tomato;\n.button { color: brand; }\n';
      const file = project.writeFile('src/Value.module.less', source);
      const lessCss = await renderLess(file, source);

      expect(lessCss).toContain('@value brand: tomato;');
      expect(lessCss).toContain('color: brand;');

      const result = await compile(file);
      const button = scopedName('button', file);

      expect(result.locals).toEqual({
        brand: 'tomato',
        button,
      });
      expect(result.css).toContain('color: tomato');
      expect(result.css).not.toContain('@value');
    });
  });
});
