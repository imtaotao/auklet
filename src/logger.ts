import { Logger, type LoggerOptions } from 'briefing';

export type AukletLogger = Logger;

export type CreateAukletLoggerOptions = Pick<
  LoggerOptions,
  'scope' | 'prefix' | 'colors' | 'silent' | 'verbose' | 'sink'
>;

export function createAukletLogger(options: CreateAukletLoggerOptions = {}) {
  return new Logger({
    prefix: options.prefix,
    scope: options.scope,
    colors: options.colors,
    silent: options.silent,
    verbose: options.verbose,
    sink: options.sink,
  });
}

export function createScopedAukletLogger(scope: string) {
  return createAukletLogger({ scope });
}
