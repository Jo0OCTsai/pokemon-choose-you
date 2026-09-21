<script setup lang="ts">
/**
 * 项目派发卡片：project 维度标签 → agent / 工作目录 / 项目上下文 的路由表。
 * 从标签行内嵌的半档派发行抽出独立成卡：字段有名字与说明（不再靠 placeholder），
 * 全部项目标签的路由一目了然。编辑草稿按标签 id 存，store 刷新时增量同步。
 */
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { useTagsStore } from "../stores/tags";
import type { AgentConfig, Tag } from "../types";
import DexSelect from "./DexSelect.vue";
import SettingRow from "./SettingRow.vue";

const props = defineProps<{ agents: AgentConfig[] }>();
const emit = defineEmits<{ feedback: [msg: string] }>();

const { t } = useI18n();
const tagsStore = useTagsStore();

interface Draft {
  agentId: string;
  workdir: string;
  context: string;
}

const projectTags = computed(() => tagsStore.list.filter((g) => (g.dimension || "topic") === "project"));

/** 已保存至少一项派发配置（状态徽标与标签行的 ⚡ 提示同一口径） */
function configured(g: Tag): boolean {
  return !!(g.meta?.workdir || g.meta?.agentId || g.meta?.context);
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
      </div>
      <SettingRow :label="t('tagDispatch.agent')" :desc="t('tagDispatch.agentDesc')" :label-width="128">
        <DexSelect v-model="row.draft.agentId" :options="agentOptions(row.draft)" />
      </SettingRow>
      <SettingRow :label="t('tagDispatch.workdir')" :desc="t('tagDispatch.workdirDesc')" wide :label-width="128">
        <input v-model="row.draft.workdir" :placeholder="t('tagDispatch.workdirPh')" spellcheck="false" />
      </SettingRow>
      <SettingRow :label="t('tagDispatch.context')" :desc="t('tagDispatch.contextDesc')" wide :label-width="128">
        <input v-model="row.draft.context" :placeholder="t('tagDispatch.contextPh')" />
      </SettingRow>
      <div class="btn-row">
        <button class="btn ghost" @click="saveMeta(row.tag)">{{ t("tags.save") }}</button>
      </div>
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
.btn-row {
  display: flex;
  gap: 10px;
}
</style>
