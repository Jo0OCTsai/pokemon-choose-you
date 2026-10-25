#!/usr/bin/env bash
# spike-dsh-ssh 可重跑脚本（AD §9）：验证点①②在本脚本 + pky-spike 探针内完成；
# 验证点③（构建产物 file: 安装解析锚点 + uiohook prebuild）由 spike-verify-anchor.sh 完成。
# 用法：bash specs/dsh-plugin-full-parity/spike/run-spike.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .../pokemon-choose-you 上一级 = 仓库根
REPO="$(cd "$REPO/.." && pwd)"
SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${PKY_SPIKE_PROFILE:-pky-test}"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
REMOTE_HOME="$(ssh localhost 'echo $HOME')"
HELPER_SRC="$REPO/dsh-plugin/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"
WS_A="/tmp/pky-spike-ws-a"
WS_B="/tmp/pky-spike-ws-b"
ALIAS_A="pky-spike-a"
ALIAS_B="pky-spike-b"
LOG_DIR="$SPIKE_DIR/logs"
REPORT="$LOG_DIR/report.json"

mkdir -p "$LOG_DIR"

echo "== [0] 前置检查 =="
[[ -f "$HELPER_SRC" ]] || { echo "缺 dsh-ssh helper 制品：$HELPER_SRC（先在仓库根 pnpm install）"; exit 1; }
ssh -o BatchMode=yes -o ConnectTimeout=5 localhost 'echo ok' >/dev/null || { echo "本机 sshd 免密不可达（spike 远端 = localhost）"; exit 1; }

echo "== [1] 远端（localhost）准备：npm 安装 dsh-ssh 包闭包 + workspace =="
# dsh-ssh 官方口径（README「Deployment prerequisites」）：远端须预装「已构建 helper
# 及其匹配的运行依赖」——lib/helper.js 是分包产物（相对导入 protocol/schemas/
# stream-security chunk + 外部依赖 cordis/dsh-fs/dsh-subprocess(-local)/dsh-sandbox*/
# dsh-session-projection/zod），单文件上传不可行（spike 关键发现，见 spike-dsh-ssh.md）。
# 故远端安装 = npm install @deepseek-ai/dsh-ssh@0.1.6-alpha.1（平台 optionalDeps 由 npm 选）。
REMOTE_RUNTIME_DIR="$REMOTE_HOME/.dsh-helper/spike-runtime"
ssh localhost "mkdir -p $WS_A $WS_B"
if ! ssh localhost "test -f $REMOTE_RUNTIME_DIR/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"; then
  REMOTE_NODE_DIR="$(dirname "$NODE_BIN")"
  ssh localhost "mkdir -p $REMOTE_RUNTIME_DIR && cd $REMOTE_RUNTIME_DIR && export PATH=$REMOTE_NODE_DIR:\$PATH && $NPM_BIN install --no-audit --no-fund @deepseek-ai/dsh-ssh@0.1.6-alpha.1" | tail -2
fi
REMOTE_HELPER="$REMOTE_RUNTIME_DIR/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"
REMOTE_HASH="$(ssh localhost "shasum -a 256 $REMOTE_HELPER" | cut -d' ' -f1)"
LOCAL_HASH="$(shasum -a 256 "$HELPER_SRC" | cut -d' ' -f1)"
echo "remote helper sha256 = ${REMOTE_HASH:0:12}…（本地插件包内制品 ${LOCAL_HASH:0:12}…）"

echo "== [2] SSH 别名（HostName localhost 复用既有 known_hosts 条目） =="
SSH_CFG="$HOME/.ssh/config"
touch "$SSH_CFG"
for ALIAS in "$ALIAS_A" "$ALIAS_B"; do
  if ! grep -q "^Host ${ALIAS}$" "$SSH_CFG"; then
    printf '\n# pky-spike 探针别名（specs/dsh-plugin-full-parity/spike）\nHost %s\n  HostName localhost\n  User %s\n' "$ALIAS" "$(whoami)" >> "$SSH_CFG"
    echo "added alias $ALIAS"
  fi
done
ssh -o BatchMode=yes -o ConnectTimeout=5 "$ALIAS_A" 'echo alias-a-ok' >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$ALIAS_B" 'echo alias-b-ok' >/dev/null

echo "== [3] spike 探针插件装入 $PROFILE profile（inert：无 PKY_SPIKE=1 不动作） =="
if ! grep -q '"pky-spike"' "$PROFILE_DIR/package.json"; then
  dsh plugin --profile "$PROFILE" add "file:$SPIKE_DIR/pky-spike" 2>&1 | tail -3
fi

echo "== [4] 启动 dsh（profile=${PROFILE}）执行探针 =="
PKY_SPIKE=1 \
PKY_SPIKE_ALIAS_A="$ALIAS_A" PKY_SPIKE_ALIAS_B="$ALIAS_B" \
PKY_SPIKE_NODE="$NODE_BIN" PKY_SPIKE_HELPER="$REMOTE_HELPER" PKY_SPIKE_HASH="$LOCAL_HASH" \
PKY_SPIKE_WS_A="$WS_A" PKY_SPIKE_WS_B="$WS_B" PKY_SPIKE_REPORT="$REPORT" \
  dsh --profile "$PROFILE" > "$LOG_DIR/dsh-boot.log" 2>&1 || true

echo "== [5] 报告 =="
if [[ -f "$REPORT" ]]; then
  python3 - "$REPORT" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(json.dumps(r.get("summary", r), ensure_ascii=False, indent=2))
for c in r.get("checks", []):
    for a in c.get("assertions", []):
        mark = "PASS" if a.get("ok") else "FAIL"
        print(f"[{mark}] {c['id']}: {json.dumps(a.get('detail', a.get('msg', '')), ensure_ascii=False)}")
PY
  grep -q '"verdict": "PASS"' <(python3 -c "import json,sys;print(json.dumps(json.load(open('$REPORT')).get('summary',{})))") && echo "SPIKE VERDICT: PASS" || echo "SPIKE VERDICT: FAIL（详见 report.json）"
else
  echo "报告未生成——检查 $LOG_DIR/dsh-boot.log"
  tail -30 "$LOG_DIR/dsh-boot.log"
  exit 1
fi
