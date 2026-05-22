import { defineKernelPackageConfigFromFile } from '#auklet/build/tsdown/define';

export {
  type TsdownFormat,
  defineKernelPackageConfigFromFile,
  defineKernelPackageConfigFromOptions,
} from '#auklet/build/tsdown/define';

export default defineKernelPackageConfigFromFile(process.cwd());
