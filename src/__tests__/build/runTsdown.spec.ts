import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTsdownArgs } from '#auklet/build/runTsdown';

describe('createTsdownArgs', () => {
  test('uses the built-in tsdown config when no config arg is provided', () => {
    const args = createTsdownArgs(['--watch']);

    expect(path.basename(args[0])).toBe('run.mjs');
    expect(args.slice(1, 5)).toEqual([
      '--config',
      expect.any(String),
      '--config-loader',
      'native',
    ]);
    expect(args[2]).toContain('tsdownConfig');
    expect(args.slice(5)).toEqual(['--watch']);
  });

  test('keeps explicit config args untouched', () => {
    const args = createTsdownArgs(['--config', 'custom.config.ts', '--watch']);

    expect(path.basename(args[0])).toBe('run.mjs');
    expect(args.slice(1)).toEqual(['--config', 'custom.config.ts', '--watch']);
  });

  test('keeps explicit config loader when using the built-in config', () => {
    const args = createTsdownArgs(['--config-loader', 'unrun', '--watch']);

    expect(path.basename(args[0])).toBe('run.mjs');
    expect(args.slice(1, 3)).toEqual(['--config', expect.any(String)]);
    expect(args.slice(3)).toEqual(['--config-loader', 'unrun', '--watch']);
  });
});
