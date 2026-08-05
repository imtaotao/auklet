import { describe, expect, test } from 'vitest';
import postcss from 'postcss';
import { prefixSelectors } from '#auklet/css/core/prefixSelectors';

describe('prefixSelectors', () => {
  test('prefixes top-level selectors including :root, html, and body', () => {
    const root = postcss.parse(`
      :root { --color: red; }
      html { font-size: 16px; }
      body { margin: 0; }
      .button { color: blue; }
    `);

    prefixSelectors(root, '.mf-app');

    expect(root.toString()).toContain('.mf-app :root');
    expect(root.toString()).toContain('.mf-app html');
    expect(root.toString()).toContain('.mf-app body');
    expect(root.toString()).toContain('.mf-app .button');
  });

  test('skips keyframes, font-face, and property rules', () => {
    const root = postcss.parse(`
      @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @-webkit-keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @font-face {
        font-family: Demo;
        src: local(Demo);
      }
      @property --progress {
        syntax: "<number>";
        inherits: false;
        initial-value: 0;
      }
      .fade { animation: fade 1s; }
    `);

    prefixSelectors(root, '.mf-app');

    expect(root.toString()).toContain('from { opacity: 0; }');
    expect(root.toString()).not.toContain('.mf-app from');
    expect(root.toString()).toContain('font-family: Demo;');
    expect(root.toString()).not.toContain('.mf-app font-family');
    expect(root.toString()).toContain('syntax: "<number>";');
    expect(root.toString()).toContain('.mf-app .fade');
  });

  test('does not double-prefix already prefixed selectors', () => {
    const root = postcss.parse(`
      .mf-app .button { color: blue; }
      .mf-app { display: block; }
      .card { color: red; }
    `);

    prefixSelectors(root, '.mf-app');

    expect(root.toString()).toContain('.mf-app .button');
    expect(root.toString()).not.toContain('.mf-app .mf-app .button');
    expect(root.toString()).toContain('.mf-app { display: block; }');
    expect(root.toString()).not.toContain('.mf-app .mf-app {');
    expect(root.toString()).toContain('.mf-app .card');
  });

  test('prefixes selectors inside media queries', () => {
    const root = postcss.parse(`
      @media (min-width: 640px) {
        .card { width: 50%; }
      }
    `);

    prefixSelectors(root, '.mf-app');

    expect(root.toString()).toContain('.mf-app .card');
  });

  test('returns the root unchanged when prefix is empty', () => {
    const root = postcss.parse('.button { color: blue; }');
    const before = root.toString();

    prefixSelectors(root, '');

    expect(root.toString()).toBe(before);
  });
});
