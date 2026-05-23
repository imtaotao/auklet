import { describe, expect, test } from 'vitest';
import { bundleFiles, listDistFiles, readDist } from './helpers';

const math = 'examples/monorepo-lib/packages/math';
const string = 'examples/monorepo-lib/packages/string';

describe('monorepo lib example', () => {
  test('emits bundle files only', () => {
    expect(listDistFiles(math)).toEqual(bundleFiles);
    expect(listDistFiles(string)).toEqual(bundleFiles);
  });

  test('keeps npm dependencies external', () => {
    expect(readDist(math, 'index.js')).toContain(
      'import { isNumber } from "aidly";',
    );
    expect(readDist(math, 'index.cjs')).toContain('require("aidly")');
  });
});
