const CSS_MODULE_FILE_RE = /\.module\.(css|less)$/i;

export function isCssModuleFile(file: string) {
  return CSS_MODULE_FILE_RE.test(file);
}
