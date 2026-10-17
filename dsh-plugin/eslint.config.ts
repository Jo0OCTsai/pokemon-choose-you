import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

// dsh-plugin 独立 lint（flat config，本包目录内运行）：对齐根 eslint.config.ts 的风格
// （tseslint recommended + prettier 免冲突），但不带 Vue 侧配置——宿主半边为纯 TS。
// 根配置已 ignore "dsh-plugin/**"，根 pnpm lint 不会重复扫描本包。
export default tseslint.config(
  {
    // helper/dist/** 是 esbuild 产物（build.mjs 生成，本地 pnpm build 后存在）——生成物不入
    // lint/棘轮口径；注意 flat config 的含斜杠 pattern 锚定本包根，需为子包显式列条目
    ignores: ["dist/**", "node_modules/**", "coverage/**", "helper/dist/**", "helper/coverage/**", "e2e/harness/**"],
  },
  ...tseslint.configs.recommended,
  {
    // ESLint v9 config 级联：从仓库根显式传参（pre-commit {staged_files}）时本配置会被
    // 就近发现并直接 lint 本包文件——固定 tsconfigRootDir 为本包目录，防与根 tsconfig
    // 产生多根歧义（typescript-eslint projectService 推断报错）
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  // Prettier 负责格式（沿根 .prettierrc.json），ESLint 关掉与之冲突的样式规则
  prettierConfig,
);
