import { resolve } from "node:path";
import { transform as esbuildTransform } from "esbuild";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * 标准装饰器降级（remoteService.ts 的 `@Remote`）：vite 8 的 oxc 转换不降级 TC39 标准装饰器
 * （target es2022 亦原样放行，实测），Node 加载即 SyntaxError——含装饰器的 .ts 先经 esbuild
 * 降级（与生产 build.mjs 同一 esbuild、同一 target 口径），oxc 再接手已是普通 JS。
 * 只命中行首 `@标识符` 的文件（JSDoc 的 ` * @tag` 不命中），其余文件零开销。
 */
function standardDecorators(): Plugin {
  return {
    name: "pky-standard-decorators",
    enforce: "pre",
    async transform(code, id) {
      if (!id.endsWith(".ts") || !/^\s*@[A-Za-z_$]/m.test(code)) {
        return null;
      }
      const result = await esbuildTransform(code, {
        loader: "ts",
        target: "es2022",
        format: "esm",
        sourcemap: true,
        sourcefile: id,
      });
      return { code: result.code, map: result.map };
    },
  };
}

// vitest 配置以 vite.config.ts 为载体（vitest 原生读取该文件名）：质量棘轮 ② 覆盖率地板的发现口径
// 只扫 <svc>/vite.config.ts 的 thresholds 四维声明（quality_ratchet_check.py RE_VITE_THRESHOLDS），
// 与根服务同构、单一声明源——不要改名为 vitest.config.ts（会脱离棘轮发现面）。
export default defineConfig({
  plugins: [standardDecorators()],
  resolve: {
    alias: {
      // 主应用字典源直引（A16）：client 半边零拷贝复用主应用三语字典 TS 源
      "@app-i18n": resolve(__dirname, "../src/i18n"),
      // 主应用宝可梦名录直引（dsh 适配层换装搜索零拷贝；catalog.json 静态数据）
      "@app-pokemon": resolve(__dirname, "../src/pokemon"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["__tests__/**/*.spec.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    coverage: {
      // business core 口径（NFR-5）：只统计宿主半边 TS 业务核心（模块挂点 README.md 不入解析）；
      // client 组件与平台胶水不入口径。json-summary 供 CI 写 job summary；lcov 供 Codecov（与前端/Rust 同构）。
      provider: "v8",
      include: ["src/host/**/*.ts"],
      // src/host/dsh/ 是 dsh 平台胶水层（hostEntry 接线/patch 面）——与 GUI 胶水同口径不进
      // 覆盖率门禁（lint/棘轮照常覆盖）；其纯逻辑映射件（toolSchema/rpcDispatch）有独立单测，
      // 真实加载面走 profile 安装冒烟验证（specs/dsh-plugin Phase A 验收口径）。
      // broker/ 同 dsh/ 口径：子进程入口薄件（装配 + runtime guard），真机验证归
      // dist 产物端到端（compatibility.md A3）与 profile 冒烟——不进覆盖率门禁。
      exclude: ["src/host/dsh/**", "src/host/broker/**"],
      reporter: ["text", "html", "lcov", "json-summary"],
      // 阈值四维同值（quality_ratchet_check.py ② 覆盖率地板发现口径）；下调须先改棘轮基线
      thresholds: { lines: 85, branches: 85, functions: 85, statements: 85 },
    },
  },
});
