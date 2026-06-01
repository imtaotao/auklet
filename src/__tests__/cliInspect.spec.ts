import { afterEach, describe, expect, test, vi } from 'vitest';
import { runInspectPackCli } from '#auklet/publish/inspectPack';
import { runInspectPublishCli } from '#auklet/publish/inspect';
import { runInspect } from '#auklet/cli/inspect';

vi.mock('#auklet/publish/inspect', () => ({
  runInspectPublishCli: vi.fn(),
}));

vi.mock('#auklet/publish/inspectPack', () => ({
  runInspectPackCli: vi.fn(),
}));

const runPack = vi.mocked(runInspectPackCli);
const runPublish = vi.mocked(runInspectPublishCli);

describe('runInspect', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('strips a top-level argument separator before the inspect subcommand', async () => {
    runPack.mockResolvedValue(0);

    await expect(
      runInspect(['--', 'pack', '--', '--filter', '@scope/ui']),
    ).resolves.toBe(0);

    expect(runPack).toHaveBeenCalledWith(['--', '--filter', '@scope/ui']);
    expect(runPublish).not.toHaveBeenCalled();
  });
});
