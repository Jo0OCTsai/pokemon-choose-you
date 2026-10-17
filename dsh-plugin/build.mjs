/**
 * 构建脚本（esbuild）：host + client 双入口 → dist/（参照 helper/build.mjs 风格）。
 *
 * 产物布局（package.json exports 单源；dsh loader 加载点）：
 *   dist/host.js    平台胶水层 + 全部 host 业务核心 bundle（ESM / platform=node / node24）
 *   dist/client.js  client 半边 React 适配层（IIFE-CJS：window.__ModuleLoader__.load 形态，
 *                   platform=browser / es2022 / 不 minify 便于排障——形态抄
 *                   dsh 侧样例 $DSH/dsh-client-ui-sidebar-right/lib/client.js 开头）
 *
 * external 口径：
 * - host：`@deepseek-ai/*`（平台面——运行时经 dsh 两锚定解析到全局 dsh 安装）+ `node:*` + electron
 * - client：仅 react / react-dom / react/jsx-runtime（宿主 module table 冻结种子提供——
 *   与 dsh 官方 client 包的 require 面一致），其余全部 bundle（含 client 组件、
 *   @app-i18n 主应用字典 TS 源、@app-pokemon 名录 JSON、CSS modules 内联注入）
 */
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// ---- 构建序：先 helper 后 host（D30/debt ⑥：helper 产物随插件包分发，files 含 helper/dist）----
// 独立子进程跑 helper/build.mjs（同为 top-level-await 脚本，不可 import 复用；esbuild 由
// helper 子包自己的 devDeps 解析）。失败即中断——host 打包不携带陈旧 helper 产物。
const helperBuild = spawnSync(process.execPath, [path.join(root, "helper", "build.mjs")], {
  stdio: "inherit",
});
if (helperBuild.status !== 0) {
  throw new Error(`helper 构建失败（exit=${helperBuild.status}）——中止插件打包`);
}

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

// ---- client 侧：CSS modules 内联注入 + 主应用源 alias ----

/**
 * CSS modules → JS 模块（dsh tsdown 产物同构：类名加文件级 hash 前缀改写 + 幂等
 * <style data-plugin-css> 注入 document.head + default 导出改写后类名映射；
 * composes 本地组合 = 导出值并置双类名、声明行剔除）。样式随 factory 闭包内联，
 * 无独立 .css 产物（module-loader IIFE 形态只认单文件 client.js）。
 */

/** 摘除 url(...) 字面量（data URI 内的 `.x` 会被类名扫描/改写误命中——svg xmlns 的 www.w3.org） */
function maskUrls(css) {
  const urls = [];
  const masked = css.replace(/url\([^)]*\)/g, (match) => {
    urls.push(match);
    return `url(__PKY_URL_${urls.length - 1}__)`;
  });
  return { masked, urls };
}

function transformCssModule(source, scope) {
  const { masked, urls } = maskUrls(source);
  const declared = new Set();
  for (const match of masked.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    declared.add(match[1]);
  }
  const composedOf = new Map();
  for (const rule of masked.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)\s*\{([^}]*)\}/g)) {
    const compose = rule[2].match(/composes:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*;/);
    if (compose !== null) {
      composedOf.set(rule[1], compose[1]);
    }
  }
  const css = masked
    .replace(/^[ \t]*composes:[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*;[ \t]*$/gm, "")
    .replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g, (whole, name) => (declared.has(name) ? `.${scope}_${name}` : whole))
    .replace(/url\(__PKY_URL_(\d+)__\)/g, (whole, index) => urls[Number(index)] ?? whole);
  const exportsMap = {};
  for (const name of declared) {
    const base = composedOf.get(name);
    exportsMap[name] = base === undefined ? `${scope}_${name}` : `${scope}_${name} ${scope}_${base}`;
  }
  return { css, exportsMap };
}

/** client CSS modules loader（注入幂等：data-plugin-css 按 文件路径 去重——HMR/重复挂载安全） */
const cssModulesPlugin = {
  name: "pky-css-modules",
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, (args) => {
      const rel = path.relative(root, args.path);
      const hash = createHash("sha1")
        .update(rel)
        .digest("base64url")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 6);
      // CSS 标识符不能以数字开头——数字首的 hash 会让整张样式表成为非法选择器被浏览器丢弃
      const scope = /^[0-9]/.test(hash) ? `_${hash}` : hash;
      const { css, exportsMap } = transformCssModule(readFileSync(args.path, "utf8"), scope);
      const tagId = `dsh-plugin/${rel}`;
      const contents = [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '  const tag = document.createElement("style");',
        '  tag.dataset.plugin = "dsh-plugin";',
        "  tag.dataset.pluginCss = tagId;",
        "  tag.textContent = css;",
        "  document.head.appendChild(tag);",
        "}",
        `export default ${JSON.stringify(exportsMap)};`,
      ].join("\n");
      return { contents, loader: "js" };
    });
  },
};

// ---- host 半边 ----

await esbuild.build({
  entryPoints: [path.join(root, "src/host/dsh/hostEntry.ts")],
  outfile: path.join(root, "dist/host.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["@deepseek-ai/*", "@electron/get", "electron", "node:*"],
  plugins: [rawPlugin],
  logLevel: "info",
});

// ---- client 半边（module-loader IIFE-CJS 包裹） ----

const CLIENT_BANNER = [
  "window.__ModuleLoader__.load({",
  '\tid: "dsh-plugin",',
  "\tfactory: (require) => {",
  "\t\tvar module = { exports: {} };",
  "\t\tvar exports = module.exports;",
].join("\n");
const CLIENT_FOOTER = ["\t\treturn module.exports;", "\t}", "});", ""].join("\n");

await esbuild.build({
  entryPoints: [path.join(root, "src/client/dsh/clientEntry.tsx")],
  outfile: path.join(root, "dist/client.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  // 宿主 module table 冻结种子：react 系（与 dsh 官方 client 包 require 面一致）；其余全 bundle。
  // @app-i18n / @app-pokemon 经 tsconfig paths 解析（esbuild 原生读 dsh-plugin/tsconfig.json）
  external: ["react", "react-dom", "react/jsx-runtime"],
  plugins: [cssModulesPlugin],
  banner: { js: CLIENT_BANNER },
  footer: { js: CLIENT_FOOTER },
  logLevel: "info",
});
