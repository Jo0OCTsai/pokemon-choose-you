<script setup lang="ts">
/**
 * 项目派发卡片：project 维度标签 → agent / 工作目录 / 项目上下文 的路由表。
 * 全部项目标签的路由一目了然。编辑草稿按标签 id 存，store 刷新时增量同步。
 * 改动即时落库（与应用其余「选中即存」一致）：下拉选中即存，文本失焦（change）即存——
 * 页面顶部「保存设置」只写 settings 表，覆盖不到这里，行内按钮曾造成两套保存心智。
 * 块头右侧「历史记录 ↗」按生效派发 agent 唤起 open_agent_history（与集成页 agent 块
 * 同一命令）；生效 agent 与后端 resolve_route 同序：标签指定 → 全局默认，无可用则置灰。
 * 目录传标签 meta workdir 覆盖（留空后端回退 agent 自身解析），历史与派发同目录。
 */
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { useTagsStore } from "../stores/tags";
import { useSettingsStore } from "../stores/settings";
import type { AgentConfig, Tag } from "../types";
import DexSelect from "./DexSelect.vue";
import SettingRow from "./SettingRow.vue";

const props = defineProps<{ agents: AgentConfig[] }>();
const emit = defineEmits<{ feedback: [msg: string] }>();

const { t } = useI18n();
const tagsStore = useTagsStore();
const settings = useSettingsStore();

interface Draft {
  agentId: string;
  workdir: string;
  context: string;
}

const projectTags = computed(() => tagsStore.list.filter((g) => (g.dimension || "topic") === "project"));

/** 已改写派发路由（指定了 agent 或目录）：context 只进提示词，不点亮徽标——
 * 只填 context 时实际仍按全局默认派发，亮「已配置」会与脚注口径矛盾 */
function configured(g: Tag): boolean {
  return !!(g.meta?.workdir || g.meta?.agentId);
}

const drafts = reactive(new Map<number, Draft>());
watch(
  projectTags,
  (list) => {
    const ids = new Set(list.map((g) => g.id));
    for (const id of [...drafts.keys()]) if (!ids.has(id)) drafts.delete(id);
    for (const g of list) {
      if (!drafts.has(g.id)) {
        drafts.set(g.id, {
          agentId: g.meta?.agentId ?? "",
          workdir: g.meta?.workdir ?? "",
          context: g.meta?.context ?? "",
        });
      }
    }
  },
  { immediate: true },
);

const rows = computed(() => projectTags.value.map((g) => ({ tag: g, draft: drafts.get(g.id)! })));

/** 派发 agent 下拉：不指定（全局默认）+ 启用的 agent（SSH 徽标）；已保存但停用的保留选项 */
function agentOptions(draft: Draft): { value: string; label: string }[] {
  const opts = [{ value: "", label: t("tagDispatch.agentNone") }];
  for (const a of props.agents) {
    if (!a.enabled && a.id !== draft.agentId) continue;
    opts.push({
      value: a.id,
      label: `${a.name || a.command}${a.remote?.host?.trim() ? " · SSH" : ""}${a.enabled ? "" : ` · ${t("tags.metaAgentOff")}`}`,
    });
  }
  return opts;
}

async function saveMeta(tag: Tag) {
  const draft = drafts.get(tag.id);
  if (!draft) return;
  try {
    await api.setTagMeta(tag.id, {
      workdir: draft.workdir || null,
      agentId: draft.agentId || null,
      context: draft.context || null,
    });
    await tagsStore.load();
    emit("feedback", t("tagSaved"));
  } catch (e) {
    emit("feedback", `❌ ${errorMessage(e)}`);
  }
}

/** 下拉选中即存（v-model 拆开手动绑定，选中后立刻落库） */
function pickAgent(tag: Tag, draft: Draft, v: string) {
  draft.agentId = v;
  void saveMeta(tag);
}

/** 生效派发 agent（与后端 resolve_route 同序）：标签指定（含已停用的已存项）→
 * 全局默认（ai_agent_id 指向启用项，否则首个启用项）；都落空 = null（快捷方式置灰） */
function effectiveAgent(draft: Draft): AgentConfig | null {
  if (draft.agentId) {
    const picked = props.agents.find((a) => a.id === draft.agentId);
    if (picked) return picked;
  }
  const preferred = settings.sget("ai_agent_id");
  return props.agents.find((a) => a.enabled && a.id === preferred) ?? props.agents.find((a) => a.enabled) ?? null;
}

function historyTitle(draft: Draft): string {
  const agent = effectiveAgent(draft);
  return agent ? t("tagDispatch.historyTip", { name: agent.name || agent.command }) : t("tagDispatch.historyNone");
}

/** 历史记录由 agent 工具自带，这里只负责在新终端唤起（同集成页 agent 块）。
 * 目录传标签 meta 的工作目录覆盖：历史会话与派发落在同一目录，
 * 留空由后端回退 agent 自身解析（配置目录或缺省 workspace） */
async function openHistory(draft: Draft) {
  const agent = effectiveAgent(draft);
  if (!agent) return;
  emit("feedback", t("ai.openingHistory"));
  try {
    emit("feedback", await api.openAgentHistory(agent.id, undefined, draft.workdir.trim() || undefined));
  } catch (e) {
    emit("feedback", `❌ ${errorMessage(e)}`);
  }
}
</script>

<template>
  <section class="set-card">
    <h3>⚡ {{ t("tagDispatch.title") }}</h3>
    <p class="set-sub">{{ t("tagDispatch.hint") }}</p>
    <div v-for="row in rows" :key="row.tag.id" class="dispatch-block">
      <div class="db-head">
        <span class="db-name" :title="row.tag.name">{{ row.tag.name }}</span>
        <span class="db-state" :class="{ on: configured(row.tag) }">
          {{ configured(row.tag) ? t("tagDispatch.configured") : t("tagDispatch.unconfigured") }}
        </span>
        <button
          class="btn mini ghost db-history"
          :disabled="!effectiveAgent(row.draft)"
          :title="historyTitle(row.draft)"
          @click="openHistory(row.draft)"
        >
          {{ t("ai.history") }}
        </button>
      </div>
      <SettingRow :label="t('tagDispatch.agent')" :label-width="128">
        <DexSelect
          :model-value="row.draft.agentId"
          :options="agentOptions(row.draft)"
          @update:model-value="(v) => pickAgent(row.tag, row.draft, v)"
        />
      </SettingRow>
      <SettingRow :label="t('tagDispatch.workdir')" :desc="t('tagDispatch.workdirDesc')" wide :label-width="128">
        <input
          v-model="row.draft.workdir"
          :placeholder="t('tagDispatch.workdirPh')"
          spellcheck="false"
          @change="saveMeta(row.tag)"
        />
      </SettingRow>
      <SettingRow :label="t('tagDispatch.context')" wide :label-width="128">
        <input v-model="row.draft.context" :placeholder="t('tagDispatch.contextPh')" @change="saveMeta(row.tag)" />
      </SettingRow>
    </div>
    <p v-if="!rows.length" class="hint">{{ t("tagDispatch.empty") }}</p>
    <p class="set-foot">{{ t("tagDispatch.foot") }}</p>
  </section>
</template>

<style scoped>
/* h3 / set-sub / set-foot 在父页是 scoped 样式，子组件内需自备同款 */
.set-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
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
.hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 8px 0 0;
  line-height: 1.7;
}
/* 单标签小节：与集成页 agent-block 同档（控件级描边） */
.dispatch-block {
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fff;
}
.db-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  min-width: 0;
}
.db-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--dex-navy);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 已配置/未配置徽标：小件级描边，配置过走 ok 软底 */
.db-state {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  border: 2px solid var(--ink-faint);
  border-radius: 4px;
  padding: 1px 8px;
  background: #fff;
  color: var(--ink-soft);
}
.db-state.on {
  border-color: var(--dex-navy);
  background: var(--ok-soft);
  color: var(--ok-ink);
}
/* 历史记录快捷方式贴块右缘：行内密集动作走全站唯一小按钮档（dex.css 的 .btn.mini） */
.db-history {
  margin-left: auto;
}
</style>
