import pluginVue from "eslint-plugin-vue";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import prettierConfig from "eslint-config-prettier";

export default defineConfigWithVueTs(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "public/**",
      "docs/design/**",
      // dsh-plugin 自带 eslint.config.ts 独立 lint（stack.json services[] 单独路由），根配置不重复扫
      "dsh-plugin/**",
    ],
  },
  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,
  {
    rules: {
      // 视图组件（App/PetApp/TaskTab…）单词命名是业务惯例
      "vue/multi-word-component-names": "off",
    },
  },
  {
    // e2e mock 在浏览器上下文里手写 IPC 协议，结构取自 Tauri 内部约定，保持 any 更贴近真实形态
    files: ["e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Prettier 负责格式（见 .prettierrc.json），ESLint 关掉与之冲突的样式规则
  prettierConfig,
  {
    // 仓内存在多份 tsconfig（根 + dsh-plugin workspace 成员）：显式固定根 tsconfigRootDir，
    // 否则 typescript-eslint projectService 在跨根文件集（如 pre-commit 显式传参）下无法
    // 唯一推断而整批解析报错（dsh-plugin/** 已在全局 ignore，不经根配置 lint）
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
);
