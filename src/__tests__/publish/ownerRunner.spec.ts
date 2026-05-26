import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runPnpmOwnerAdd } from '#auklet/publish/api/pnpmApi';
import { OwnerRunner } from '#auklet/publish/ownerRunner';
import { resolveOwnerPackageNames } from '#auklet/publish/targetResolver';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  runPnpmOwnerAdd: vi.fn(),
}));

vi.mock('#auklet/publish/targetResolver', () => ({
  resolveOwnerPackageNames: vi.fn(),
}));

const addOwner = vi.mocked(runPnpmOwnerAdd);
const resolvePackageNames = vi.mocked(resolveOwnerPackageNames);

describe('OwnerRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requires at least one owner target package', async () => {
    resolvePackageNames.mockResolvedValue([]);

    await expect(
      new OwnerRunner({
        cwd: '/repo',
        filters: ['@scope/*'],
        otp: undefined,
        packages: [],
        users: ['arthur'],
      }).run(),
    ).rejects.toThrow('no owner target package found');
  });

  test('adds every requested owner to every resolved package', async () => {
    resolvePackageNames.mockResolvedValue(['@scope/theme', '@scope/ui']);

    await new OwnerRunner({
      cwd: '/repo',
      filters: ['@scope/*'],
      otp: '123456',
      packages: [],
      users: ['arthur', 'bot'],
    }).run();

    expect(addOwner).toHaveBeenCalledTimes(4);
    expect(addOwner).toHaveBeenNthCalledWith(1, '@scope/theme', 'arthur', {
      cwd: '/repo',
      otp: '123456',
    });
    expect(addOwner).toHaveBeenNthCalledWith(2, '@scope/theme', 'bot', {
      cwd: '/repo',
      otp: '123456',
    });
    expect(addOwner).toHaveBeenNthCalledWith(3, '@scope/ui', 'arthur', {
      cwd: '/repo',
      otp: '123456',
    });
    expect(addOwner).toHaveBeenNthCalledWith(4, '@scope/ui', 'bot', {
      cwd: '/repo',
      otp: '123456',
    });
  });
});
