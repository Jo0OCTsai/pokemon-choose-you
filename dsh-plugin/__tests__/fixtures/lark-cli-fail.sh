#!/bin/sh
# fake lark-cli（网络失败态）：user_info 非零退出码 + stderr 错误（网络不可达口径），
# auth status 输出坏 JSON（按未登录兜底）。
case "$1 $2" in
  "auth status")
    printf '%s' 'garbage not json' ;;
esac
case "$3" in
  /open-apis/authen/v1/user_info)
    echo 'network unreachable: connect ETIMEDOUT' >&2; exit 7 ;;
  *)
    echo 'network unreachable' >&2; exit 7 ;;
esac
