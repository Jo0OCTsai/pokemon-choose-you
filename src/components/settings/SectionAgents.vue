<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { useSettingsStore } from "../../stores/settings";
import { useAgentsStore } from "../../stores/agents";
import AgentSessionHistory from "../AgentSessionHistory.vue";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";
import AgentConfigCard from "./AgentConfigCard.vue";

/**
 * 「Agent」分区（自 SectionIntegrations 拆出）：AI agent 管理（列表/CRUD/隧道与技能状态在
 * agents store + AgentConfigCard，这里只剩分区级预设下拉与主 agent 单选）、待办派发自动化、
 * 会话历史（待办派发卡下方，「配好自动化 → 回看跑过的会话」同屏动线）。
 */
const { t } = useI18n();
const settings = useSettingsStore();
const agentsStore = useAgentsStore();

// ---- AI agent CLI 管理：列表/CRUD/隧道与技能状态上移 agents store（预设 AGENT_PRESETS 也在那），
//      单个 agent 的编辑卡抽到 AgentConfigCard，这里只剩分区级的预设下拉与主 agent 单选 ----
const presetOptions = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "kiro", label: "Kiro CLI" },
  { value: "pi", label: "pi" },
  { value: "qoder", label: "Qoder CLI" },
  { value: "custom", label: "Custom" },
];
const agentPreset = ref("claude");
/** 用于收音机分类的 agent（分区级单选，与其他表单行同一套下拉控件）；空 = 不指定。
 * 标签带本机/SSH 徽标：同类型多 agent（本地 + 远程各一）时单选可辨 */
const primaryAgentOptions = computed(() => [
  { value: "", label: t("ai.primaryNone") },
  ...agentsStore.list
    .filter((a) => a.enabled)
    .map((a) => ({
      value: a.id,
      label: `${a.name || a.command}${a.remote?.host?.trim() ? " · SSH" : ""}`,
    })),
]);

function addAgent() {
  agentsStore.add(agentPreset.value);
}

/** 平台限定的说明只在对应平台渲染（DESIGN_SYSTEM.md §4.4 说明文字四层归属） */
const isLinux = /linux/i.test(navigator.userAgent);
/** 终端偏好选项按当前平台裁剪：可选值与后端 TerminalPref 对齐（default 恒可选） */
const isMac = /mac/i.test(navigator.userAgent);
const isWin = /win/i.test(navigator.userAgent);
const terminalOptions = computed(() => {
  const opts = [{ value: "default", label: t("ai.termBuiltin") }];
  if (isMac) {
    opts.push({ value: "iterm2", label: "iTerm2" }, { value: "ghostty", label: "Ghostty" });
  } else if (isWin) {
    opts.push({ value: "windows-terminal", label: "Windows Terminal" });
  } else if (isLinux) {
    opts.push({ value: "ghostty", label: "Ghostty" });
  }
  return opts;
});

// 派发自动化（M3）：开关只写本地 values，随「保存设置」落库
const dispatchAutoOn = useSettingToggle("dispatch_auto_enabled");
const dispatchWorktreeOn = useSettingToggle("dispatch_worktree");
const maxConcurrentOptions = computed(() =>
  [1, 2, 3].map((n) => ({ value: String(n), label: t("dispatchCfg.mcN", { n }) })),
);
</script>

<template>
  <section class="set-card">
    <h3>{{ t("ai.title") }}</h3>
    <p class="set-sub">{{ t("ai.hint") }}</p>
    <SettingRow :label="t('ai.primary')">
      <DexSelect v-model="settings.values.ai_agent_id" :options="primaryAgentOptions" />
    </SettingRow>
    <SettingRow :label="t('ai.terminal')" :desc="t('ai.terminalDesc')">
      <DexSelect v-model="settings.values.terminal_preference" :options="terminalOptions" />
    </SettingRow>
    <!-- 单 agent 编辑卡：字段/SSH/隧道状态/测试历史/技能/远程一键配置都在卡内（agents store 取数） -->
    <AgentConfigCard v-for="ag in agentsStore.list" :key="ag.id" :agent-id="ag.id" />
    <div class="btn-row add-agent">
      <DexSelect v-model="agentPreset" :options="presetOptions" />
      <button class="btn ghost" @click="addAgent">{{ t("ai.add") }}</button>
    </div>
    <p class="set-foot">{{ t("ai.cliHint") }}</p>
  </section>

  <!-- 待办派发：M3 自动化与隔离（默认全关；手动派发不受这些开关影响） -->
  <section class="set-card">
    <h3>{{ t("dispatchCfg.title") }}</h3>
    <p class="set-sub">{{ t("dispatchCfg.hint") }}</p>
    <SettingRow :label="t('dispatchCfg.auto')" :desc="t('dispatchCfg.autoDesc')">
      <DexToggle v-model="dispatchAutoOn" />
    </SettingRow>
    <SettingRow :label="t('dispatchCfg.maxConcurrent')" :desc="t('dispatchCfg.maxConcurrentDesc')">
      <DexSelect v-model="settings.values.dispatch_max_concurrent" :options="maxConcurrentOptions" />
    </SettingRow>
    <SettingRow :label="t('dispatchCfg.worktree')" :desc="t('dispatchCfg.worktreeDesc')">
      <DexToggle v-model="dispatchWorktreeOn" />
    </SettingRow>
    <p class="set-foot">{{ t("dispatchCfg.foot") }}</p>
  </section>

  <!-- 会话历史：收音机分类 + 待办派发共用 agent_sessions，按执行时快照回放（不分本地/远程） -->
  <section class="set-card">
    <h3>{{ t("sess.title") }}</h3>
    <p class="set-sub">{{ t("sess.hint") }}</p>
    <AgentSessionHistory />
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
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 10px;
}
.add-agent {
  align-items: center;
}
</style>
