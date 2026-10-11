// 复杂度棘轮专用 eslint 配置 —— 只被 .devcontainer/scripts/quality_ratchet_check.py 消费
// （本地 Stop hook / CI 棘轮步骤），不进主 lint 门槛（pnpm lint / stack.json lint_check 不读本文件）。
// 存量违规经 .devcontainer/scripts/quality-ratchet-baseline.json 豁免——基线只准收缩，新增即红。
// import .ts 主配置需 Node ≥23.6（原生 type-stripping）。规则与根 eslint.ratchet.config.js 同构。
import base from "./eslint.config.ts";

export default [
  ...base,
  {
    name: "ratchet/complexity",
    rules: {
      complexity: ["error", 10],
      "max-lines-per-function": ["error", 50],
      "max-lines": ["error", 300],
    },
  },
  {
    // client 半边 React 视图组件（.tsx）：JSX 模板行计入函数体，与 Vue SFC「模板不进
    // script 函数」的口径不可比（根仓 frontend 同体量视图组件在 vue 侧不触发本规则）——
    // 对视图文件关闭 max-lines-per-function，complexity / max-lines 两维照常棘轮。
    name: "ratchet/react-view-components",
    files: ["src/client/**/*.tsx"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
  {
    // client 组件测试（__tests__/client）：渲染装配/夹具函数天然超过 50 行——与根仓
    // frontend 测试规格的既有口径一致（其长测试经基线豁免存量运行）；此处显式免
    // max-lines-per-function，complexity / max-lines 两维照常棘轮。
    name: "ratchet/client-test-assembly",
    files: ["__tests__/client/**"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
];
