// 复杂度棘轮专用 eslint 配置 —— 只被 .devcontainer/scripts/quality_ratchet_check.py 消费
// （本地 Stop hook / CI 棘轮步骤），不进主 lint 门槛（pnpm lint / stack.json lint_check 不读本文件）。
// 存量违规经 .devcontainer/scripts/quality-ratchet-baseline.json 豁免——基线只准收缩，新增即红。
// import .ts 主配置需 Node ≥23.6（原生 type-stripping）。
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
];
