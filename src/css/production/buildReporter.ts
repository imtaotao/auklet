import path from 'node:path';
import type { AukletLogger } from '#auklet/logger';
import type { ModuleStyleBuildResult } from '#auklet/types';

export function logModuleStyleBuildResult(
  logger: AukletLogger,
  result: ModuleStyleBuildResult,
  elapsed: number,
) {
  logger.step(`Build ${path.basename(result.packageRoot)}`);

  logger.item(
    logger.colors.bold(logger.colors.yellow(String(result.styleFiles.length))),
    logger.colors.bold(logger.colors.white(' source style file(s), ')),
    logger.colors.bold(logger.colors.yellow(String(result.outputs.length))),
    logger.colors.bold(logger.colors.white(' output entry file(s)')),
  );

  if (result.outputs.length) {
    const rows = result.outputs.map((output) => [
      logger.path(path.relative(result.packageRoot, output.file)),
      `${(output.size / 1000).toFixed(2)} kB`,
    ]);
    const sizeWidth = Math.max(...rows.map(([, size]) => String(size).length));

    logger.rows({
      rows: rows.map(([file, size]) => [
        file,
        logger.colors.gray(String(size).padStart(sizeWidth)),
      ]),
    });
  }

  logger.success('Build complete in ', logger.duration(elapsed));
}
