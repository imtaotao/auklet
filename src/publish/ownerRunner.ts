import { runPnpmOwnerAdd } from '#auklet/publish/api/pnpmApi';
import { resolveOwnerPackageNames } from '#auklet/publish/targetResolver';
import type { OwnerOptions } from '#auklet/publish/types';

export class OwnerRunner {
  constructor(private readonly options: OwnerOptions) {}

  async run() {
    const packageNames = await resolveOwnerPackageNames(this.options);
    if (!packageNames.length) {
      throw new Error('[auklet:publish] no owner target package found.');
    }

    for (const packageName of packageNames) {
      for (const user of this.options.users) {
        await runPnpmOwnerAdd(packageName, user, {
          cwd: this.options.cwd,
          otp: this.options.otp,
        });
      }
    }
  }
}
