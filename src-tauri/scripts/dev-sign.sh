#!/bin/bash
# dev 二进制稳定签名（macOS）：让辅助功能授权不随重编译失效。
#
# 背景：tauri dev 的 debug 二进制是 ad-hoc 签名，代码身份（cdhash）每次重编译都变，
# macOS 辅助功能（TCC）按签名身份匹配授权条目 → 重编译即失效，要反复重新授权。
# 方案：首次运行自动生成本机自签代码签名证书（存登录钥匙串，仅此一份），
# 之后每次构建后用同一张证书 + 固定 identifier 重签——designated requirement
# 只含「证书 + identifier」，与 cdhash 无关，跨编译稳定，授权一次长期有效。
# 仅本机开发自用；发布版分发签名（Developer ID + 公证）是另一条线，见 docs/DEVELOPMENT.md。
#
# 用法：
#   scripts/dev-sign.sh              # 签 target/debug/pokemon-choose-you
#   scripts/dev-sign.sh <二进制路径>  # 签指定文件
#   scripts/dev-sign.sh exec <二进制> [参数…]  # cargo runner 模式：先签再原样执行
# （src-tauri/.cargo/config.toml 已把本脚本配为 darwin target 的 runner，
#   tauri dev / cargo run 自动生效；测试产物在 deps/ 下会跳过，不影响测试速度。）
# 证书丢失后重跑会生成新证书，辅助功能需重新授权一次。

set -euo pipefail

IDENTITY="pokemon-choose-you dev"
APP_ID="com.jotsai.pokemonchooseyou"
SRC_TAURI="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_BIN="$SRC_TAURI/target/debug/pokemon-choose-you"

have_mac_tools() {
  command -v security >/dev/null 2>&1 && command -v codesign >/dev/null 2>&1
}

# 证书不在本机钥匙串（CI / 新机器未初始化）→ 跳过签名，保持 ad-hoc 原样。
# 注意自签证书不受系统信任，find-identity -v 列不出来，要用 find-certificate 探测
# （签它不需要信任链，只要证书+私钥配对在钥匙串里）。
have_identity() {
  security find-certificate -c "$IDENTITY" >/dev/null 2>&1
}

# 首次运行：生成自签证书并导入登录钥匙串（随机口令只活在内存里，落盘即焚）
ensure_identity() {
  if have_identity; then return 0; fi
  echo "dev-sign: 首次运行——生成自签代码签名证书并导入登录钥匙串（仅此一次）…" >&2
  local tmp pw
  tmp="$(mktemp -d)"
  pw="$(openssl rand -hex 16)"
  cat > "$tmp/openssl.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = pokemon-choose-you dev
O = pokemon-choose-you
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" \
    -config "$tmp/openssl.cnf" >/dev/null 2>&1
  openssl pkcs12 -export -name "$IDENTITY" \
    -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
    -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 \
    -passout "pass:$pw" -out "$tmp/cert.p12"
  # -T 预授权 /usr/bin/codesign 使用私钥（首次签名若仍弹钥匙串授权，点「始终允许」）
  security import "$tmp/cert.p12" -P "$pw" -T /usr/bin/codesign >/dev/null
  rm -rf "$tmp"
  have_identity
}

sign() { # sign <二进制>
  have_mac_tools || return 0
  case "$1" in
    */deps/*) return 0 ;; # 测试产物跳过：不需要稳定身份，省得拖慢 cargo test
  esac
  if ! ensure_identity; then
    echo "dev-sign: 证书不可用，跳过签名（保持 ad-hoc）" >&2
    return 0
  fi
  local err
  if ! err="$(codesign --force --sign "$IDENTITY" --identifier "$APP_ID" "$1" 2>&1)"; then
    echo "dev-sign: 重签失败（二进制正在运行或证书不可用？详情：$err）" >&2
  fi
}

case "${1:-}" in
  exec) # cargo runner：exec <二进制> [参数…] —— 先签再原样执行
    shift
    if [[ $# -gt 0 ]]; then sign "$1"; fi
    exec "$@"
    ;;
  sign)
    shift
    sign "${1:-$DEFAULT_BIN}"
    ;;
  "")
    sign "$DEFAULT_BIN"
    ;;
  *)
    sign "$1"
    ;;
esac
