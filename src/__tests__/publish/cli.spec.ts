import { afterEach, describe, expect, test, vi } from 'vitest';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { runOwnerCli, runPublishCli } from '#auklet/publish/cli';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { PublishRunner } from '#auklet/publish/publishRunner';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  ensurePnpm: vi.fn(),
}));

vi.mock('#auklet/publish/ownerRunner', () => ({
  OwnerRunner: vi.fn(function OwnerRunner() {
    return { run: vi.fn() };
  }),
}));

vi.mock('#auklet/publish/publishRunner', () => ({
  PublishRunner: vi.fn(function PublishRunner() {
    return { run: vi.fn() };
  }),
}));

const ensurePnpmExists = vi.mocked(ensurePnpm);
const createOwnerRunner = vi.mocked(OwnerRunner);
const createPublishRunner = vi.mocked(PublishRunner);

describe('runPublishCli', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('ignores a leading args separator from package scripts', async () => {
    await runPublishCli([
      '--filter',
      '@scope/*',
      '--allow-dirty',
      '--',
      '--version',
      'patch',
    ]);

    expect(ensurePnpmExists).toHaveBeenCalled();
    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 'patch',
        allowDirty: true,
        format: true,
        filters: ['@scope/*'],
      }),
    );
  });

  test('passes --no-format as the publish output format switch', async () => {
    await runPublishCli(['--no-format']);

    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        format: false,
      }),
    );
  });

  test('passes --no-git as the publish release git switch', async () => {
    await runPublishCli(['--no-git']);

    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        git: false,
      }),
    );
  });

  test('passes npm token as a publish option', async () => {
    await runPublishCli(['--token', 'npm_secret']);

    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'npm_secret',
      }),
    );
  });

  test('rejects unknown --no-prefixed flags', async () => {
    await expect(runPublishCli(['--no-build'])).rejects.toThrow(
      'unknown option: --no-build',
    );
  });
});

describe('runOwnerCli', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('rejects unknown owner subcommands', async () => {
    await expect(runOwnerCli(['xx'])).rejects.toThrow(
      'expected owner command: auk owner add <user...>',
    );
  });

  test('requires at least one owner user', async () => {
    await expect(runOwnerCli(['add'])).rejects.toThrow(
      'owner add requires at least one user',
    );
  });

  test('passes default selectors for owner add without package arguments', async () => {
    await runOwnerCli(['add', 'alice']);

    expect(ensurePnpmExists).toHaveBeenCalled();
    expect(createOwnerRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        users: ['alice'],
        filters: [],
        packages: [],
      }),
    );
  });

  test('passes owner filter and otp options', async () => {
    await runOwnerCli([
      'add',
      'alice',
      '--filter',
      '@scope/ui',
      '--otp',
      '123456',
    ]);

    expect(createOwnerRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        users: ['alice'],
        filters: ['@scope/ui'],
        otp: '123456',
      }),
    );
  });
});
