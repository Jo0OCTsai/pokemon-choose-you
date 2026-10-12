/**
 * 构建脚本（esbuild）：host 入口 TS 源 → dist/host.js（参照 helper/build.mjs 风格）。
 *
 * 产物布局（package.json main = dist/host.js，dsh loader 加载点）：
 *   dist/host.js  平台胶水层 + 全部 host 业务核心 bundle（ESM / platform=node / node24）
 *
 * external 口径：
 * - `@deepseek-ai/*`：平台面（dsh-tools/schemastery/cordis…）——运行时经 dsh 两锚定
 *   解析到全局 dsh 安装（peerDependencies 声明版本兼容，不打进产物）
 * - `node:*` 与 electron：内建与宿主运行时
 * - client 半边（react 等）不入 host 产物——client 入口 Phase B 单独构建
 */
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * vite `?raw` 等价 loader：契约 SQL（contracts/schema/）编译期内嵌进产物——
 * 安装形态（profile node_modules）磁盘相对路径不可达，迁移单源靠内嵌注册
 * （src/host/storage/schema-raw.ts 的 ?raw 链路，hostEntry 启动时注册）。
 */
const rawPlugin = {
  name: "contracts-raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(root, "src/host/dsh/hostEntry.ts")],
  outfile: path.join(root, "dist/host.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["@deepseek-ai/*", "electron", "node:*"],
  plugins: [rawPlugin],
  logLevel: "info",
});
