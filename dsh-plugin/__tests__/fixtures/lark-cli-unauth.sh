#!/bin/sh
# fake lark-cli（未授权态）：user_info 返回 ok=false 的未授权信封（退出码 0），
# auth status 报 available=false——驱动 LARK_UNAUTHORIZED 与授权跳转口径。
case "$1 $2" in
  "auth status")
    printf '%s' '{"appId":"cli_x","identities":{"user":{"status":"unauthenticated","available":false}}}'
    exit 0 ;;
  "config show")
    echo '{"ok":false,"error":{"subtype":"not_configured"}}' >&2
    exit 3 ;;
esac
case "$3" in
  /open-apis/authen/v1/user_info)
    printf '%s' '{"ok":false,"error":"not logged in"}' ;;
  *)
    printf '%s' '{"ok":false,"error":"not logged in"}' ;;
esac
