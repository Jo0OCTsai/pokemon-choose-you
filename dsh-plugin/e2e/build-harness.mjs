/**
 * E2E harness 构建脚本（esbuild）：把「真实构建产物 dist/client.js + mockHost 数据面」
 * 组装成可被 Playwright 打开的静态页（specs/dsh-plugin-full-parity plan §5 客户端面 E2E）。
 *
 * 产物（harness/ 目录，经典 script 顺序加载——无 module 协议依赖，file:// 可开）：
 *   vendor.js  React 19 全局（react + react-dom——client bundle 的 external 面）
 *   pre.js     ModuleLoader shim（jsx-runtime 由 createElement 合成）+ mockHost 伪 rpc + dsh ctx
 *   client.js  dist/client.js 拷贝（IIFE 调 window.__ModuleLoader__.load → 捕获 {inject, apply}）
 *   boot.js    apply(伪 ctx) → 渲染 main 面板（PANEL_ID 槽组件）到 #root
 */
import * as esbuild from "esbuild";
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(root, "..");
const out = path.join(root, "harness");

// 1) React 全局（client external 面的宿主侧供给——等价 dsh module table 冻结种子）
await esbuild.build({
  stdin: {
    resolveDir: pkg,
    contents: `
      import * as React from "react";
      import * as ReactDOM from "react-dom";
      import * as ReactDOMClient from "react-dom/client";
      window.React = React;
      window.ReactDOM = { ...ReactDOM, createRoot: ReactDOMClient.createRoot };
    `,
    loader: "js",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: path.join(out, "vendor.js"),
  logLevel: "info",
});

// 2) pre：ModuleLoader shim + mockHost 伪 rpc（测试与产物之间的唯一假面 = 连接层）
await esbuild.build({
  entryPoints: [path.join(root, "src", "pre-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: path.join(out, "pre.js"),
  logLevel: "info",
});

// 3) boot：渲染 main 面板
await esbuild.build({
  entryPoints: [path.join(root, "src", "boot-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: path.join(out, "boot.js"),
  logLevel: "info",
});

// 4) 真实构建产物拷贝（断言对象 = dist 形态，非源码重打）
cpSync(path.join(pkg, "dist", "client.js"), path.join(out, "client.js"));
console.log("harness built →", out);
