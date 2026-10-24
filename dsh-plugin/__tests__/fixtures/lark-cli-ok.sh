#!/bin/sh
# fake lark-cli（正常增量态）——对齐 Rust feishu.rs 测试的假脚本先例：按 $3（API 路径）路由，
# messages 再按 $5（params JSON 内 container_id）分会话。数据集：
#   身份 ou_me/乔老板；会话 bot/好友/发给自己/项目群/免打扰灌水群；
#   项目群成员 张三(ou_z)/王五(ou_wang)；消息覆盖 @我（显式）、@他人、手打名字、图片。
case "$1 $2" in
  "auth status")
    printf '%s' '{"appId":"cli_x","identities":{"user":{"status":"ready","available":true,"userName":"乔老板","tokenStatus":"valid"}},"identity":"user"}'
    exit 0 ;;
  "config show")
    printf '%s' '{"ok":true}'
    exit 0 ;;
esac
case "$3" in
  /open-apis/authen/v1/user_info)
    printf '%s' '{"ok":true,"data":{"open_id":"ou_me","name":"乔老板"}}' ;;
  /open-apis/im/v1/chats)
    printf '%s' '{"ok":true,"data":{"items":[
        {"chat_id":"oc_bot","name":"皮卡丘助手","chat_mode":"p2p","p2p_target_type":"bot","p2p_target_id":"ou_bot2"},
        {"chat_id":"oc_friend","name":"李四","chat_mode":"p2p","p2p_target_type":"user","p2p_target_id":"ou_li"},
        {"chat_id":"oc_myself","name":"我","chat_mode":"p2p","p2p_target_type":"user","p2p_target_id":"ou_me"},
        {"chat_id":"oc_group","name":"项目群","chat_mode":"group"},
        {"chat_id":"oc_noisy","name":"灌水群","chat_mode":"group"}
      ],"has_more":false}}' ;;
  /open-apis/im/v1/chat_user_setting/batch_query)
    printf '%s' '{"ok":true,"data":{"items":[{"chat_id":"oc_noisy","is_muted":true}]}}' ;;
  /open-apis/im/v1/messages)
    case "$5" in
      *'"container_id":"oc_bot"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_b1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"提醒我明早9点站会\"}"}},
            {"message_id":"om_b2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_bot","sender_type":"app"},"body":{"content":"{\"text\":\"收到啦，我会提醒你\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_friend"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_f1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_li","sender_type":"user"},"body":{"content":"{\"text\":\"把合同发我一下\"}"}},
            {"message_id":"om_f2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"好的马上\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_myself"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_s1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"明早出门前寄快递\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_noisy"'*)
        printf '%s' '{"ok":true,"data":{"items":[{"message_id":"om_noisy","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_zhao","sender_type":"user"},"body":{"content":"{\"text\":\"灌水消息不该出现\"}"} }],"has_more":false}}' ;;
      *'"container_id":"oc_group"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_g1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"@_user_1 周会改到周四10点\"}"},"mentions":[{"key":"@_user_1","name":"乔老板","id":"ou_me","id_type":"open_id"}]},
            {"message_id":"om_g2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"收到\"}"}},
            {"message_id":"om_g4","msg_type":"image","create_time":"1789200003000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"image_key\":\"k\"}"}},
            {"message_id":"om_g5","msg_type":"text","create_time":"1789200004000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"@_user_2 你来写周报\"}"},"mentions":[{"key":"@_user_2","name":"王五","id":"ou_wang","id_type":"open_id"}]},
            {"message_id":"om_g6","msg_type":"text","create_time":"1789200005000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"乔老板帮我看下发布单\"}"}}
          ],"has_more":false}}' ;;
      *)
        echo 'unexpected chat' >&2; exit 1 ;;
    esac ;;
  /open-apis/im/v1/chats/oc_group/members)
    printf '%s' '{"ok":true,"data":{"items":[{"member_id":"ou_z","name":"张三"},{"member_id":"ou_wang","name":"王五"}],"has_more":false}}' ;;
  *)
    echo "unexpected path $3" >&2; exit 1 ;;
esac
