import { createHash } from 'node:crypto';
import path from 'node:path';
import { normalizeFileKey } from '#auklet/utils';

const MODULE_SUFFIX_RE = /\.module\.(css|less)$/i;

export function generateScopedName(
  localName: string,
  filename: string,
  _css: string,
) {
  const base = path.basename(filename).replace(MODULE_SUFFIX_RE, '');
  const hash = createHash('sha256')
    .update(`${normalizeFileKey(filename)}:${localName}`)
    .digest('base64url')
    .slice(0, 6);
  return `${base}_${localName}_${hash}`;
}
