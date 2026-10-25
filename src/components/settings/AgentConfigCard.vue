<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { ACTION_TOAST, SKILL_TOAST } from "../../composables/useActionToast";
import { useAgentsStore } from "../../stores/agents";
import { useDeploymentsStore } from "../../stores/deployments";
import type { AgentConfig } from "../../types";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 单个 AI agent 编辑卡（自 SettingsTab 抽出）：字段编辑、SSH 远程执行、常驻隧道状态行、
 * 测试/历史、pk 技能检查安装与远程一键配置。
 * 数据自取 agents store（agentId 定位，一键配置落库重载后跟随新对象）；状态条与忙位经
 * provide/inject 与父级共用同一条底部状态条——testing / skillBusy 两个忙位，不各自实例化。
 */
const props = defineProps<{ agentId: string }>();
const { t } = useI18n();
const agentsStore = useAgentsStore();
const deploymentsStore = useDeploymentsStore();
const { busy: testing, run: runAction } = inject(ACTION_TOAST)!;
const { busy: skillBusy, run: runSkill } = inject(SKILL_TOAST)!;

/** 卡片绑定的 agent（父级 v-for 只渲染存在的 id） */
const ag = computed(() => agentsStore.list.find((a) => a.id === props.agentId)!);

/** 绑定部署下拉选项：本机执行 + 部署注册表 ∪ ~/.ssh/config 候选 */
const bindingOptions = computed(() => [
  { value: "", label: t("ai.local") },
  ...deploymentsStore.bindingOptions.map((a) => ({ value: a, label: a })),
]);

/** agent 位置徽标：绑部署显示别名，未绑显示「本机」 */
function agentPlace(a: AgentConfig): string {
  const alias = a.deployment?.trim();
  return alias ? `SSH · ${alias}` : t("ai.local");
}

async function testAgent(a: AgentConfig) {
  await runAction(t("testing"), async () => {
    await agentsStore.save();
    return api.testAiConfig(a.id);
  });
}

/** 历史记录由 agent 工具自带（claude --resume 等），这里只负责在新终端唤起 */
async function openHistory(a: AgentConfig) {
  await runAction(t("ai.openingHistory"), async () => {
    await agentsStore.save();
    return api.openAgentHistory(a.id);
  });
}

// ---- agent 的 pk 技能：检查 / 安装同步（本地与远程同一组入口，远程写远端机器目录） ----
async function checkSkill(a: AgentConfig) {
  await runSkill("", async () => {
    await agentsStore.save();
    agentsStore.skillStatus[a.id] = await api.agentSkillStatus(a.id);
  });
}

async function installSkill(a: AgentConfig) {
  await runSkill(t("ai.skillInstalling"), async () => {
    await agentsStore.save();
    const r = await api.agentSkillInstall(a.id);
    const where = r.remoteHost ? r.remoteHost : t("ai.local");
    agentsStore.skillStatus[a.id] = await api.agentSkillStatus(a.id).catch(() => agentsStore.skillStatus[a.id]);
    return r.updated
      ? t("ai.skillUpdated", { v: r.version, prev: r.previousVersion || "?", where })
      : t("ai.skillInstalled", { v: r.version, where });
  });
}

/** 技能状态一行字（未检查 / 未安装 / 已装 vN / 可更新） */
function skillText(a: AgentConfig): string {
  const s = agentsStore.skillStatus[a.id];
  if (!s) return t("ai.skillUnknown");
  if (!s.installed) return t("ai.skillNotInstalled");
  return s.upToDate
    ? t("ai.skillUpToDate", { v: s.installedVersion || "?" })
    : t("ai.skillOutdated", { v: s.installedVersion || "?", b: s.bundledVersion });
}
</script>

<template>
  <div class="agent-block" :class="{ off: !ag.enabled }">
    <div class="agent-row">
      <input v-model="ag.name" class="agent-name" :placeholder="t('ai.namePh')" />
      <input v-model="ag.command" class="agent-cmd" :placeholder="t('ai.cmdPh')" />
      <!-- 徽标放命令框之后：命令框左缘固定在 120px 名字 + 8px 间隙 = 128px，
           与下方 SettingRow(label-width 128) 的输入列对齐（徽标宽度不定，放中间会顶歪） -->
      <span class="badge agent-place" :class="{ ssh: !!ag.deployment?.trim() }" :title="agentPlace(ag)">{{
        agentPlace(ag)
      }}</span>
      <DexToggle v-model="ag.enabled" :title="t('ai.enabled')" />
      <button class="btn ghost del" @click="agentsStore.remove(ag.id)">{{ t("ai.remove") }}</button>
    </div>
    <SettingRow :label="t('ai.args')" wide :label-width="128">
      <input v-model="ag.args" :placeholder="t('ai.argsPh')" />
    </SettingRow>
    <SettingRow :label="t('ai.workdir')" wide :label-width="128">
      <input v-model="ag.workdir" :placeholder="t('ai.workdirPh')" />
    </SettingRow>
    <SettingRow :label="t('ai.historyArgs')" wide :label-width="128">
      <input v-model="ag.historyArgs" placeholder="--resume" />
    </SettingRow>
    <SettingRow :label="t('ai.skillDir')" wide :label-width="128">
      <input v-model="ag.skillDir" :placeholder="t('ai.skillDirPh')" />
    </SettingRow>
    <SettingRow :label="t('ai.skill')" wide :label-width="128">
      <div class="skill-line">
        <span
          class="skill-state"
          :class="{
            ok: agentsStore.skillStatus[ag.id]?.upToDate,
            stale: agentsStore.skillStatus[ag.id] && !agentsStore.skillStatus[ag.id].upToDate,
          }"
          :title="agentsStore.skillStatus[ag.id]?.dir"
        >
          {{ skillText(ag) }}
        </span>
        <button class="btn ghost" :disabled="skillBusy || testing" @click="checkSkill(ag)">
          {{ t("ai.skillCheck") }}
        </button>
        <button class="btn ghost" :disabled="skillBusy || testing" @click="installSkill(ag)">
          {{ t("ai.skillInstall") }}
        </button>
      </div>
    </SettingRow>
    <SettingRow :label="t('ai.timeout')">
      <input v-model.number="ag.timeoutSecs" type="number" min="10" step="10" />
    </SettingRow>
    <SettingRow :label="t('ai.bindDeployment')" :desc="t('ai.bindDeploymentDesc')">
      <DexSelect
        :model-value="ag.deployment || ''"
        :options="bindingOptions"
        @update:model-value="(v: string) => (ag.deployment = v || null)"
      />
    </SettingRow>
    <div class="btn-row">
      <button class="btn ghost" @click="agentsStore.save()">{{ t("ai.save") }}</button>
      <button class="btn ghost" :disabled="testing" @click="testAgent(ag)">
        {{ t("ai.test") }}
      </button>
      <button class="btn ghost" :disabled="testing" @click="openHistory(ag)">
        {{ t("ai.history") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* AI agent 配置块（样式自 SettingsTab 随卡迁入；.btn/.badge 质感来自全局 dex.css） */
.agent-block {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fff;
}
.agent-block.off {
  opacity: 0.55;
}
.agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.agent-row input {
  padding: 7px 9px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
.agent-name {
  width: 120px;
  flex: none;
}
/* 位置徽标：复用小件级 badge 控件；SSH 变体用图鉴蓝底白字。主机名是信息文本，
 * 不拉字距不加粗，超长省略 */
.agent-place {
  flex: none;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
  font-weight: 400;
}
.agent-place.ssh {
  background: var(--rest-blue);
  color: #fff;
}
.agent-cmd {
  flex: 1;
  min-width: 0;
}
/* pk 技能状态行：状态字 + 检查/安装按钮 */
.skill-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.skill-state {
  margin-left: auto; /* 状态字贴按钮排右缘，与超时/开关同一条右轴 */
  min-width: 0;
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-state.ok {
  color: var(--ok-ink);
}
.skill-state.stale {
  color: var(--warn-ink);
}
/* 常驻隧道开关行：开关 + 状态点并排；配色沿用技能状态行的语义色 */
.tunnel-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.tunnel-state {
  font-size: 12px;
  color: var(--ink-soft);
  /* 状态列钳宽：异常长内容（如未收口的报错）省略号截断，不把整行撑爆 */
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tunnel-state.healthy {
  color: var(--ok-ink);
}
.tunnel-state.retrying,
.tunnel-state.connecting {
  color: var(--warn-ink);
}
.agent-row .btn {
  padding: 7px 10px;
  min-height: 38px;
  font-size: 13px;
}
/* 按钮行（页级 .btn-row 基础样式触不到子组件内部，随卡补齐） */
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.agent-block .btn.del {
  color: var(--danger);
}
/* SSH 远程执行配置行：与上方命令输入框左缘对齐（agent-name 120px + 行间距 8px = 128px） */
.agent-block .ssh-row {
  padding-left: 128px;
}
.ssh-row .ssh-port {
  width: 84px;
  flex: none;
  padding: 6px 8px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  min-height: 38px;
  box-shadow: 3px 3px 0 var(--dex-navy);
}
</style>
