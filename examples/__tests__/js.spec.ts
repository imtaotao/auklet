import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const math = 'examples/libs/packages/math';
const ui = 'examples/components/packages/ui';
const dashboard = 'examples/components/packages/dashboard';

const readDist = (packageDir: string, file: string) => {
  return fs.readFileSync(path.join(process.cwd(), packageDir, 'dist', file), {
    encoding: 'utf8',
  });
};

describe('examples JavaScript dependencies', () => {
  test('keeps npm dependencies external', () => {
    expect(readDist(math, 'index.js')).toContain(
      'import { isNumber } from "aidly";',
    );
    expect(readDist(math, 'index.cjs')).toContain('require("aidly")');
  });

  test('keeps workspace dependencies external', () => {
    const importUi = 'import { Button, Card } from "@demo/ui";';

    expect(readDist(dashboard, 'index.js')).toContain(importUi);
    expect(readDist(dashboard, 'es/components/Dashboard/index.js')).toContain(
      importUi,
    );
    expect(readDist(dashboard, 'index.cjs')).toContain('require("@demo/ui")');
  });

  test('uses relative imports inside module output', () => {
    expect(readDist(ui, 'es/components/Card/index.js')).toContain(
      'import { Button } from "../Button/index.js";',
    );
  });
});
