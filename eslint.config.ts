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
);
