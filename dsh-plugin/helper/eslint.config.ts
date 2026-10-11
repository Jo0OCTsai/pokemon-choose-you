import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

// helper 子包独立 lint（flat config，本包目录内运行）：风格对齐 dsh-plugin/eslint.config.ts
// （tseslint recommended + prettier 免冲突）。注意根配置 ignore "dsh-plugin/**"、dsh-plugin 配置
// 以 `eslint .` 扫到本目录时本文件作为嵌套 config 级联合并——两份配置同源同风格，无冲突。
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  // Prettier 负责格式（沿根 .prettierrc.json），ESLint 关掉与之冲突的样式规则
  prettierConfig,
);
