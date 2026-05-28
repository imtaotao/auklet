import { describe, expect, test, vi } from 'vitest';
import { resolvePublishVersion } from '#auklet/publish/version';

vi.mock('#auklet/publish/api/gitApi', () => ({
  getGitShortHash: vi.fn(() => 'a1b2c3d'),
}));

describe('resolvePublishVersion', () => {
  test('increments release versions from the stable prerelease base', async () => {
    await expect(
      resolvePublishVersion('0.1.0-beta.abcdef', 'patch', process.cwd()),
    ).resolves.toBe('0.1.1');
    await expect(
      resolvePublishVersion('0.1.0-beta.abcdef', 'minor', process.cwd()),
    ).resolves.toBe('0.2.0');
    await expect(
      resolvePublishVersion('0.1.0-beta.abcdef', 'major', process.cwd()),
    ).resolves.toBe('1.0.0');
  });

  test('uses git hash suffix for alpha and beta versions', async () => {
    await expect(
      resolvePublishVersion('0.1.0-beta.abcdef', 'alpha', process.cwd()),
    ).resolves.toBe('0.1.0-alpha.a1b2c3d');
    await expect(
      resolvePublishVersion('0.1.0-alpha.abcdef', 'beta', process.cwd()),
    ).resolves.toBe('0.1.0-beta.a1b2c3d');
  });
});
