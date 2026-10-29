/**
 * 测试用 pk bundle 现场打包帮手（信封回放与 remote 套件共用）：esbuild 打
 * src/pk/main.ts → 临时单文件 ESM（node shebang 形态与正式构建同构）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { rawPlugin } from "../../raw-loader.mjs";

const dshRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface TestBundle {
  /** bundle 绝对路径 */
  path: string;
  /** metafile（依赖图断言用） */
  meta: import("esbuild").Metafile;
}

let cached: TestBundle | null = null;

export async function buildPkBundle(): Promise<TestBundle> {
  if (cached !== null) return cached;
  const dir = mkdtempSync(join(tmpdir(), "pk-cli-ts-"));
  const out = join(dir, "pk.mjs");
  const result = await esbuild.build({
    entryPoints: [join(dshRoot, "src", "pk", "main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: out,
    metafile: true,
    define: { __PK_CLI_VERSION__: '"9.9.9-test"' },
    plugins: [rawPlugin],
    logLevel: "silent",
  });
  cached = { path: out, meta: result.metafile! };
  return cached;
}
