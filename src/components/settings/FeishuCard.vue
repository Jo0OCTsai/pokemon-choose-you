<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { SETTING_KEYS, useSettingsStore } from "../../stores/settings";
import type { FeishuOauthStatus } from "../../types";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 飞书设置卡（自 SettingsTab 拆出）：开关/轮询间隔/我的称呼/测试与立即拉取。
 * 授权状态与登录动作由父级持有（页面挂载即预取，避免进入分区闪「未授权」），
 * 这里经 props 展示、emit 触发登录；测试按钮沿用底部状态条的 testing 忙位（inject 同一实例）。
 */
defineProps<{ feishuAuth: FeishuOauthStatus | null; oauthBusy: boolean }>();
const emit = defineEmits<{ login: [] }>();

const { t } = useI18n();
const settings = useSettingsStore();
const { busy: testing, run } = inject(ACTION_TOAST)!;
const feishuOn = useSettingToggle("feishu_enabled");
const pollIntervalOptions = computed(() =>
  [1, 2, 5, 15].map((n) => ({ value: String(n * 60), label: t("focus.minutes", { n }) })),
);

async function runTest(fn: () => Promise<string>) {
  await run(t("testing"), async () => {
    await settings.save(SETTING_KEYS);
    return fn();
  });
}
</script>

<template>
  <section class="set-card">
    <h3>💬 {{ t("tabs.im") === "Radio" ? "Feishu" : "飞书" }}</h3>
    <p class="set-sub">{{ t("feishu.hint") }}</p>
    <div class="auth-line">
      <span class="auth-state">
        {{
          feishuAuth?.authorized
            ? t("feishu.authorized", { name: feishuAuth.userName || "?" })
            : t("feishu.unauthorized")
        }}
      </span>
      <button class="btn ghost" :disabled="oauthBusy || testing" @click="emit('login')">
        {{ oauthBusy ? t("feishu.authing") : feishuAuth?.authorized ? t("feishu.reauth") : t("feishu.auth") }}
      </button>
    </div>
    <SettingRow :label="t('feishu.enable')">
      <DexToggle v-model="feishuOn" />
    </SettingRow>
    <SettingRow :label="t('feishu.interval')">
      <DexSelect v-model="settings.values.feishu_poll_interval" :options="pollIntervalOptions" />
    </SettingRow>
    <SettingRow :label="t('feishu.myNames')" :desc="t('feishu.myNamesDesc')">
      <input v-model="settings.values.feishu_my_names" class="agent-cmd" :placeholder="t('feishu.myNamesPh')" />
    </SettingRow>
    <div class="btn-row">
      <button class="btn ghost" :disabled="testing" @click="runTest(api.testFeishuConfig)">
        {{ t("feishu.test") }}
      </button>
      <button
        class="btn ghost"
        :disabled="testing"
        @click="runTest(async () => t('feishu.pollResult', { n: await api.triggerFeishuPoll() }))"
      >
        {{ t("feishu.pollNow") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 共享壳样式（自 SettingsTab 复制的 scoped 副本：分区子组件沿用通用类的既定做法） */
.set-card {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 4px 4px 0 var(--dex-navy);
}
.set-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
/* 说明文字四层归属的页面两层（行内 desc 在 SettingRow 组件内）：区块副标题 + 卡片脚注 */
.set-sub {
  margin: -6px 0 12px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 10px;
}
/* AI agent 配置块的单卡样式已随 AgentConfigCard 迁出；此处留 .agent-cmd
 * 给飞书「我的称呼」输入框复用同款质感 */
.agent-cmd {
  flex: 1;
  min-width: 0;
}
/* 飞书授权状态行：状态文字居左、授权按钮贴右（与其他设置行的控件方位一致） */
.auth-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  /* 底部间距与 SettingRow 的行距节奏一致（set-row margin-bottom 10px），
   * 4px 时授权按钮与下一行的开关/按钮几乎贴住 */
  margin: 8px 0 10px;
}
.auth-state {
  font-size: 12px;
  font-weight: 700;
  color: var(--dex-navy);
}
</style>
