<script setup lang="ts">
import type { FeishuOauthStatus } from "../../types";
import FeishuChatFilterManager from "../FeishuChatFilterManager.vue";
import FeishuCard from "./FeishuCard.vue";

/**
 * 「飞书」分区（自 SectionIntegrations 拆出）：外部服务授权 + 会话过滤。
 * 授权状态与登录动作由父级持有（页面挂载即预取，进入分区不闪「未授权」），经 props/emit 接线。
 */
defineProps<{ feishuAuth: FeishuOauthStatus | null; oauthBusy: boolean }>();
const emit = defineEmits<{ login: [] }>();
</script>

<template>
  <FeishuCard :feishu-auth="feishuAuth" :oauth-busy="oauthBusy" @login="emit('login')" />

  <!-- 会话过滤：逐会话三态偏好（组件自取数，点击即写库即时生效，不进 save 缓冲） -->
  <FeishuChatFilterManager />
</template>
