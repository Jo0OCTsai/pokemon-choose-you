<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../../api";
import { clipWrite } from "../../contextMenu";
import { ACTION_TOAST } from "../../composables/useActionToast";
import { useSettingToggle } from "../../composables/useSettingToggle";
import { useSettingsStore } from "../../stores/settings";
import PokemonPicker from "../PokemonPicker.vue";
import DexToggle from "../DexToggle.vue";
import SettingRow from "../SettingRow.vue";
import QuotesEditorCard from "./QuotesEditorCard.vue";

/**
 * 「桌宠」分区（桌宠域收拢至此，自原 cats/focus 分区拆出）：主宝可梦选择与台词编辑（外观）、
 * 输入响应/语音/伙伴（行为）。输入授权状态 inputPerm/inputExe 由父级持有（save 契约的
 * petInputSetEnabled 同步与窗口聚焦复查都要读写），经 props 传入；这里只渲染未授权
 * 指引块与一键直达授权按钮。
 */
defineProps<{ inputPerm: boolean; inputExe: string }>();

const { t } = useI18n();
const settings = useSettingsStore();
const { flash } = inject(ACTION_TOAST)!;
const petInputOn = useSettingToggle("pet_input_response");
const petInputWorkOn = useSettingToggle("pet_input_response_working");
const petVoiceOn = useSettingToggle("pet_voice");
const petMateOn = useSettingToggle("pet_mate");

/** 主宝可梦：选中即存（桌宠空闲展示即时生效，桌宠窗口经 settings-changed 跟随） */
async function saveMainPokemon(key: string) {
  settings.values.main_pokemon = key;
  await settings.save(["main_pokemon"]);
  flash(t("saved"));
}

/** 一键授权引导：Finder 定位当前二进制 + 直达 系统设置→辅助功能 面板
 *  （这版 macOS 禁止了 AX 官方弹窗，只能把用户送到正确的面板） */
async function grantInputPerm() {
  try {
    await api.petInputGrant();
  } catch {
    /* 非桌面环境静默 */
  }
}
</script>

<template>
  <section class="set-card">
    <h3>{{ t("cats.mainTitle") }}</h3>
    <SettingRow :label="t('cats.mainLabel')" :desc="t('cats.mainDesc')">
      <PokemonPicker
        :model-value="settings.values.main_pokemon"
        :allow-empty-label="t('cats.mainFollow')"
        @update:model-value="saveMainPokemon"
      />
    </SettingRow>
    <p class="set-foot">{{ t("cats.spriteHint") }}</p>
  </section>

  <QuotesEditorCard />

  <section class="set-card">
    <h3>{{ t("focus.petTitle") }}</h3>
    <SettingRow :label="t('focus.petInput')" :desc="t('focus.petInputDesc')">
      <DexToggle v-model="petInputOn" />
    </SettingRow>
    <SettingRow v-if="petInputOn" :label="t('focus.petInputWorking')" :desc="t('focus.petInputWorkingDesc')">
      <DexToggle v-model="petInputWorkOn" />
    </SettingRow>
    <!-- 未授权指引：一键直达辅助功能面板 + 当前二进制路径（可拖进列表/复制后 ⌘⇧G） -->
    <div v-if="petInputOn && !inputPerm" class="perm-hint">
      <p>{{ t("focus.petInputPerm") }}</p>
      <p class="perm-exe-row">
        <code class="perm-exe" :title="t('focus.petInputExeCopy')" @click="void clipWrite(inputExe)">{{
          inputExe || "…"
        }}</code>
        <button class="btn ghost mini" @click="grantInputPerm">
          {{ t("focus.petInputGrant") }}
        </button>
      </p>
    </div>
    <SettingRow :label="t('focus.petVoice')" :desc="t('focus.petVoiceDesc')">
      <DexToggle v-model="petVoiceOn" />
    </SettingRow>
    <SettingRow :label="t('focus.petMate')" :desc="t('focus.petMateDesc')">
      <DexToggle v-model="petMateOn" />
    </SettingRow>
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
.set-foot {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
/* 输入响应未授权指引：说明 + 当前二进制路径（点击复制）+ 去授权按钮 */
.perm-hint {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 2px dashed var(--ink-faint);
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}
.perm-exe-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.perm-exe {
  max-width: 100%;
  overflow-wrap: anywhere;
  cursor: copy;
  font-size: 11px;
  padding: 2px 6px;
  border: 2px solid var(--ink-faint);
  border-radius: 6px;
  background: var(--dex-body);
}
</style>
