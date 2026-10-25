/**
 * 构建脚本（esbuild）：TS 源 → dist 产物，供 `electron .` 本地运行。
 *
 * 产物布局（package.json main = dist/main.js）：
 *   dist/main.js            主进程 ESM（external: electron；electron-app 动态 import 分块）
 *   dist/preload.cjs        sandbox 预载（CJS）
 *   dist/renderer/          渲染层（index.html 原样拷贝 + renderer.js/css bundle + 字体资产）
 *   dist/renderer/pokemon/  内置精灵（拷贝主应用 public/pokemon/——分发口径单源）
 *   dist/renderer/pokemon-catalog.json  全量图鉴 key→id（拷贝主应用 src/pokemon/catalog.json，
 *                            构建期拷贝 = 单一源在主应用，同 pk CLI binaries 先例）
 */
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");
const dist = path.join(root, "dist");

mkdirSync(dist, { recursive: true });

// 1) 主进程（ESM + code splitting：headless 动态 import 不加载 electron 分块的前提）
await esbuild.build({
  entryPoints: [path.join(root, "src/main.ts")],
  outfile: path.join(dist, "main.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  // electron = 运行时注入；uiohook-napi = 原生模块（prebuild 经 dsh-plugin 根 dependencies
  // 分发，helper/dist 向上寻址插件包 node_modules 解析——AD §7.2/A31，不可打包）
  external: ["electron", "uiohook-napi"],
  // ESM 产物没有 __dirname（源码里 preload/renderer 路径用它）——banner 注入等价物；
  // 每个分块（electron-app 动态 import chunk）都会带上同款 banner
  banner: {
    js: `import { fileURLToPath as __pcyUrlToPath } from "node:url";
const __dirname = __pcyUrlToPath(new URL(".", import.meta.url));`,
  },
  logLevel: "info",
});

// 2) preload（sandbox 预载必须 CJS）
await esbuild.build({
  entryPoints: [path.join(root, "src/preload.ts")],
  outfile: path.join(dist, "preload.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  external: ["electron"],
  logLevel: "info",
});

// 3) 渲染层（bundle + 字体/图片资产随 css 自动落 outdir）
await esbuild.build({
  entryPoints: [path.join(root, "src/renderer/renderer.ts")],
  outdir: path.join(dist, "renderer"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome130",
  assetNames: "assets/[name]-[hash]",
  loader: { ".woff": "file", ".woff2": "file", ".png": "file", ".gif": "file" },
  logLevel: "info",
});

// 4) 静态资产：index.html / 内置精灵 / 全量 catalog（复用主应用分发口径，NFR-9）
cpSync(path.join(root, "src/renderer/index.html"), path.join(dist, "renderer/index.html"));
cpSync(path.join(repoRoot, "public/pokemon"), path.join(dist, "renderer/pokemon"), {
  recursive: true,
});
cpSync(path.join(repoRoot, "src/pokemon/catalog.json"), path.join(dist, "renderer/pokemon-catalog.json"));
