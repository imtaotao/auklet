import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTsdownArgs } from '#auklet/build/runTsdown';

describe('createTsdownArgs', () => {
  test('uses the built-in tsdown config when no config arg is provided', () => {
    const args = createTsdownArgs(['--watch']);

    expect(path.basename(args[0])).toBe('run.mjs');
    expect(args.slice(1, 3)).toEqual(['--config', expect.any(String)]);
    expect(args[2]).toContain('tsdownConfig');
    expect(args.slice(3)).toEqual(['--watch']);
  });

  test('keeps explicit config args untouched', () => {
    const args = createTsdownArgs(['--config', 'custom.config.ts', '--watch']);

    expect(path.basename(args[0])).toBe('run.mjs');
    expect(args.slice(1)).toEqual(['--config', 'custom.config.ts', '--watch']);
  });
});
