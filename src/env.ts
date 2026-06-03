import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { findWorkspaceRoot } from '#auklet/workspace/root';

const envFileNames = ['.env', '.env.local'];

export class AukletEnvContext {
  private readonly env: Record<string, string | undefined>;
  private readonly processEnv: Record<string, string | undefined>;

  constructor(
    private readonly packageRoot: string,
    private readonly root?: string,
    options: {
      processEnv?: Record<string, string | undefined>;
    } = {},
  ) {
    this.processEnv = { ...(options.processEnv ?? process.env) };
    this.env = this.createProcessEnvOverrides(this.readEnv());
  }

  get values() {
    return this.env;
  }

  get normalizedValues() {
    return Object.keys(this.values).length ? this.values : undefined;
  }

  createPackageContext(packageRoot: string) {
    return new AukletEnvContext(packageRoot, this.root, {
      processEnv: this.processEnv,
    });
  }

  resolveValue(
    value: string | undefined,
    options: {
      label: string;
    },
  ) {
    if (!value) return undefined;
    if (!value.startsWith('env:')) return value;

    const name = value.slice('env:'.length);
    if (!name) {
      throw new Error(`${options.label} env: requires an environment name.`);
    }

    const resolved = this.processEnv[name] ?? this.values[name];
    if (!resolved) {
      throw new Error(`${options.label} environment is missing: ${name}`);
    }
    return resolved;
  }

  resolveBoolean(
    value: boolean | string | undefined,
    options: {
      label: string;
    },
  ) {
    if (value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (!value) return true;

    const resolved = this.resolveValue(value, options);
    if (resolved === undefined || !resolved) return true;

    const normalized = resolved.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

    throw new Error(`${options.label} requires a boolean value.`);
  }

  async run<T>(fn: () => Promise<T>) {
    const originalEnv = { ...process.env };

    for (const [key, value] of Object.entries(this.values)) {
      if (originalEnv[key] === undefined && value !== undefined) {
        process.env[key] = value;
      }
    }

    try {
      return await fn();
    } finally {
      process.env = originalEnv;
    }
  }

  private readEnv() {
    const env: Record<string, string> = {};
    for (const file of this.findEnvFiles()) {
      Object.assign(env, parseEnv(fs.readFileSync(file, 'utf8')));
    }
    return env;
  }

  private findEnvFiles() {
    const files: Array<string> = [];
    const packageDir = path.resolve(this.packageRoot);
    const rootDir = path.resolve(
      this.root ?? findWorkspaceRoot(packageDir) ?? packageDir,
    );
    // Files are read in order and later files override earlier ones.
    // Final priority is process.env > package .env.local > package .env >
    // root .env.local > root .env.
    const rootEnvFiles = envFileNames.map((fileName) =>
      path.join(rootDir, fileName),
    );
    const packageEnvFiles = envFileNames.map((fileName) =>
      path.join(packageDir, fileName),
    );

    for (const file of rootEnvFiles) {
      if (fs.existsSync(file)) {
        files.push(file);
      }
    }
    for (const file of packageEnvFiles) {
      if (!files.includes(file) && fs.existsSync(file)) {
        files.push(file);
      }
    }
    return files;
  }

  private createProcessEnvOverrides(env: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(env).filter(([key]) => this.processEnv[key] === undefined),
    );
  }
}
