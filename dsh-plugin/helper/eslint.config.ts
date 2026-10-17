import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import type { Linter } from "eslint";

// helper 子包独立 lint（flat config，本包目录内运行）：风格对齐 dsh-plugin/eslint.config.ts
// （tseslint recommended + prettier 免冲突）。注意根配置 ignore "dsh-plugin/**"、dsh-plugin 配置
// 以 `eslint .` 扫到本目录时本文件作为嵌套 config 级联合并——两份配置同源同风格，无冲突。
//
// 机械红线（full-parity NFR-13/AD §4.3，进 CI）：
// - sys/**（输入计数挂点）：rawcode/keycode 标识符禁入——「只计数」红线的机械化断言
//   （键值/键名 0 读取；NFR-13 代码审查清单的 CI 面）；
// - renderer/**：innerHTML / insertAdjacentHTML 禁入——桥文本字段一律 textContent 赋值
//   （host 组装文案亦不视为可信——纵深防御）。
const INPUT_PRIVACY_BAN: { "no-restricted-syntax": Linter.RuleEntry } = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "Identifier[name='rawcode']",
      message: "NFR-13 只计数红线：inputCount 模块禁读取 rawcode（键值 0 采集）——回调只做计数器自增。",
    },
    {
      selector: "Identifier[name='keycode']",
      message: "NFR-13 只计数红线：inputCount 模块禁读取 keycode（键名 0 采集）——回调只做计数器自增。",
    },
  ],
};

const RENDERER_HTML_BAN: { "no-restricted-syntax": Linter.RuleEntry } = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "MemberExpression[computed=false][property.name='innerHTML']",
      message: "渲染层文本红线：一律 textContent 赋值（桥文本不视为可信——AD §4.3 纵深防御）。",
    },
    {
      selector: "Identifier[name='insertAdjacentHTML']",
      message: "渲染层文本红线：一律 textContent 赋值（桥文本不视为可信——AD §4.3 纵深防御）。",
    },
  ],
};

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
  {
    files: ["src/sys/**"],
    rules: { ...INPUT_PRIVACY_BAN },
  },
  {
    files: ["src/renderer/**"],
    rules: { ...RENDERER_HTML_BAN },
  },
);
