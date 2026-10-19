<script setup lang="ts">
import { inject, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useAgentsStore } from "../../stores/agents";
import { useDeploymentsStore } from "../../stores/deployments";
import type { DeploymentView, RemotePkReport } from "../../types";
import DexSelect from "../DexSelect.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";

/**
 * 远程部署管理卡（ADR-0003）：部署注册表 CRUD（别名下拉读 ~/.ssh/config）、
 * pk 通道开通（部署驱动，成功落 pkTunnel）、常驻隧道状态、存量迁移横幅与悬空绑定呈现。
 * dsh helper 开通向导不在此（归 dsh 插件面板——桌面派发 ssh 直呼 agent CLI）。
 */
const { t } = useI18n();
const deploymentsStore = useDeploymentsStore();
const agentsStore = useAgentsStore();
const { busy, msg, run } = inject(ACTION_TOAST)!;

/** 编辑中的新部署表单（空别名 = 不显示编辑区） */
const draft = reactive({
  id: "" as string,
  alias: "",
  nodePath: "/usr/bin/node",
  workdir: "",
  note: "",
  port: 10022 as number | null,
  persistent: false,
});

function resetDraft() {
  draft.id = "";
  draft.alias = "";
  draft.nodePath = "/usr/bin/node";
  draft.workdir = "";
  draft.note = "";
  draft.port = 10022;
  draft.persistent = false;
}

const editing = ref(false);
/** 别名下拉候选：config 候选 ∪ 既有部署别名（编辑保留原值可选） */
const aliasOptions = ref<string[]>([]);

function startCreate() {
  resetDraft();
  aliasOptions.value = deploymentsStore.bindingOptions;
  editing.value = true;
}

function startEdit(d: DeploymentView) {
  draft.id = d.id;
  draft.alias = d.alias;
  draft.nodePath = d.nodePath;
  draft.workdir = d.workdir;
  draft.note = d.note;
  draft.port = d.pkTunnel?.port ?? 10022;
  draft.persistent = d.pkTunnel?.persistent ?? false;
  aliasOptions.value = Array.from(new Set([d.alias, ...deploymentsStore.bindingOptions])).sort();
  editing.value = true;
}

async function saveDraft() {
  await run(t("dep.saving"), async () => {
    await deploymentsStore.upsert({
      id: draft.id || undefined,
      alias: draft.alias.trim(),
      nodePath: draft.id ? draft.nodePath.trim() || undefined : draft.nodePath.trim(),
      workdir: draft.workdir.trim(),
      note: draft.note.trim(),
      pkTunnel: draft.port ? { port: Number(draft.port), persistent: draft.persistent } : null,
    });
    editing.value = false;
    resetDraft();
    agentsStore.load();
    return t("dep.saved");
  });
}

async function removeDeployment(d: DeploymentView) {
  await run(t("dep.removing"), async () => {
    await deploymentsStore.remove(d.id);
    agentsStore.load();
    return t("dep.removed", { alias: d.alias });
  });
}

/** pk 通道开通：分步报告进状态条（失败步带修复建议，可重试——幂等） */
async function setupPk(d: DeploymentView) {
  await run(t("dep.settingUp"), async () => {
    const report = await deploymentsStore.setupPk(d.id, d.pkTunnel?.port);
    msg.value = renderReport(report);
    return report.ok ? t("dep.setupDone", { v: report.version || "?" }) : t("dep.setupFailed");
  });
}

function renderReport(r: RemotePkReport): string {
  if (r.ok) return "";
  const failed = r.steps.find((s) => s.status === "fail");
  return failed ? `❌ ${failed.name}：${failed.detail}` : `❌ ${t("dep.setupFailed")}`;
}

/** 常驻隧道状态文案（部署级；让位待命态由 dsh 双宿主场景引入） */
function tunnelText(d: DeploymentView): string {
  const s = deploymentsStore.tunnelStates[d.id];
  if (!s) return t("dep.tunnelUnknown");
  return (
    (
      {
        healthy: t("dep.tunnelHealthy"),
        connecting: t("dep.tunnelConnecting"),
        retrying: t("dep.tunnelRetrying"),
      } as Record<string, string>
    )[s.state] ?? t("dep.tunnelOff")
  );
}

function tunnelTitle(d: DeploymentView): string {
  const s = deploymentsStore.tunnelStates[d.id];
  const text = tunnelText(d);
  return s?.detail ? `${text}：${s.detail}` : text;
}

/** 存量迁移：一键把 agent 内联远程配置归并为部署绑定（幂等；config 先备份） */
async function migrate() {
  await run(t("dep.migrating"), async () => {
    const r = await deploymentsStore.migrate();
    agentsStore.load();
    const parts = [
      r.created.length ? t("dep.migCreated", { n: r.created.length }) : "",
      r.rebound ? t("dep.migRebound", { n: r.rebound }) : "",
      r.configBackup ? t("dep.migBackup", { path: r.configBackup }) : "",
    ].filter(Boolean);
    return parts.length ? parts.join("；") : t("dep.migNone");
  });
}
</script>

<template>
  <div class="card deploy-card">
    <h2>{{ t("dep.title") }}</h2>
    <p class="card-desc">{{ t("dep.desc") }}</p>

    <!-- 悬空绑定提示：删除部署后遗留的绑定（派发会被拒，指引补建或改绑） -->
    <p v-if="deploymentsStore.dangling.length" class="dangling">
      {{ t("dep.dangling", { names: deploymentsStore.dangling.map((d) => `${d.agentName}→${d.alias}`).join("、") }) }}
    </p>

    <div v-for="d in deploymentsStore.list" :key="d.id" class="deploy-row">
      <div class="deploy-main">
        <span class="deploy-alias" :title="d.note">{{ d.alias }}</span>
        <span
          v-if="d.pkTunnel?.persistent"
          class="tunnel-state"
          :class="deploymentsStore.tunnelStates[d.id]?.state || 'off'"
          :title="tunnelTitle(d)"
          >● {{ tunnelText(d) }}</span
        >
        <span v-else-if="d.pkTunnel" class="tunnel-state off">{{ t("dep.tunnelOff") }}</span>
        <span v-if="d.degraded" class="tunnel-state retrying" :title="d.lastError || ''">{{ t("dep.degraded") }}</span>
      </div>
      <div class="deploy-actions">
        <button class="btn ghost" :disabled="busy" @click="setupPk(d)">{{ t("dep.setupPk") }}</button>
        <button class="btn ghost" :disabled="busy" @click="startEdit(d)">{{ t("dep.edit") }}</button>
        <button class="btn ghost del" :disabled="busy" @click="removeDeployment(d)">
          {{ t("dep.remove") }}
        </button>
      </div>
    </div>

    <div v-if="editing" class="deploy-edit">
      <SettingRow :label="t('dep.alias')" :desc="t('dep.aliasDesc')">
        <DexSelect v-model="draft.alias" :options="aliasOptions.map((a) => ({ value: a, label: a }))" />
      </SettingRow>
      <SettingRow :label="t('dep.nodePath')">
        <input v-model="draft.nodePath" placeholder="/usr/bin/node" />
      </SettingRow>
      <SettingRow :label="t('dep.workdir')">
        <input v-model="draft.workdir" :placeholder="t('dep.workdirPh')" />
      </SettingRow>
      <SettingRow :label="t('dep.note')">
        <input v-model="draft.note" :placeholder="t('dep.notePh')" />
      </SettingRow>
      <SettingRow :label="t('dep.tunnelPort')" :desc="t('dep.tunnelPortDesc')">
        <div class="tunnel-cell">
          <input v-model.number="draft.port" class="port-input" type="number" min="1" max="65535" />
          <DexToggle v-model="draft.persistent" :title="t('dep.persistent')" />
        </div>
      </SettingRow>
      <div class="btn-row">
        <button class="btn ghost" :disabled="!draft.alias.trim() || busy" @click="saveDraft">
          {{ t("dep.save") }}
        </button>
        <button
          class="btn ghost"
          @click="
            editing = false;
            resetDraft();
          "
        >
          {{ t("dep.cancel") }}
        </button>
      </div>
    </div>
    <div v-else class="btn-row">
      <button class="btn ghost" @click="startCreate">{{ t("dep.add") }}</button>
      <button class="btn ghost" :disabled="busy" @click="migrate">{{ t("dep.migrate") }}</button>
    </div>
  </div>
</template>

<style scoped>
.deploy-card :deep(.deploy-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 2px dashed var(--dex-navy-soft, #c9d4e4);
}
.deploy-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.deploy-alias {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deploy-actions {
  display: flex;
  gap: 8px;
  flex: none;
}
.tunnel-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}
.port-input {
  width: 96px;
}
.tunnel-state {
  font-size: 12px;
  color: var(--ink-soft);
  max-width: 320px;
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
.dangling {
  color: var(--warn-ink);
  font-size: 12px;
}
.deploy-edit {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 10px 0;
}
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.btn.del {
  color: var(--danger);
}
</style>
