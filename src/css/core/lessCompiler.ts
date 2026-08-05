import path from 'node:path';
import less from 'less';

export async function compileLess(file: string, code: string) {
  try {
    const result = await less.render(code, {
      filename: file,
      paths: [path.dirname(file)],
    });
    return {
      css: result.css,
      imports: (result.imports ?? []).map((imported) => path.resolve(imported)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[css] failed to compile Less file ${file}: ${message}`);
  }
}

export type LessCompileResult = Awaited<ReturnType<typeof compileLess>>;
