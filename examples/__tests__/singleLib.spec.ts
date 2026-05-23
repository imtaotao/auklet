import { describe, expect, test } from 'vitest';
import { bundleFiles, listDistFiles, readDist } from './helpers';

const singleLib = 'examples/single-lib';

describe('single lib example', () => {
  test('emits bundle files only', () => {
    expect(listDistFiles(singleLib)).toEqual(bundleFiles);
  });

  test('builds JavaScript output', () => {
    expect(readDist(singleLib, 'index.js')).toContain('function formatName');
    expect(readDist(singleLib, 'index.cjs')).toContain('function formatName');
  });
});
