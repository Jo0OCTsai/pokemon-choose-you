<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "vue-i18n";
import { api, errorMessage } from "../api";
import { EVENTS } from "../events";
import { SETTING_KEYS, useSettingsStore } from "../stores/settings";
import { useAgentsStore } from "../stores/agents";
import { useTagsStore } from "../stores/tags";
import type { BackupInfo, FeishuOauthStatus } from "../types";
import { ACTION_TOAST, SKILL_TOAST, useActionToast } from "../composables/useActionToast";
import { useSettingToggle } from "../composables/useSettingToggle";
import SectionCats from "../components/settings/SectionCats.vue";
import SectionDiag from "../components/settings/SectionDiag.vue";
import SectionDisplay from "../components/settings/SectionDisplay.vue";
import SectionFocus from "../components/settings/SectionFocus.vue";
import SectionGeneral from "../components/settings/SectionGeneral.vue";
import SectionIntegrations from "../components/settings/SectionIntegrations.vue";
import SectionTags from "../components/settings/SectionTags.vue";

/** App 壳监听到 update-available 后传入的版本号（空串 = 无新版本） */
defineProps<{ latestVersion?: string }>();

const { t } = useI18n();
const settings = useSettingsStore();
const tagsStore = useTagsStore();
const agentsStore = useAgentsStore();

// ---- 底部状态条 + 动作外壳（useActionToast）：主忙位 testing 与技能忙位分开、共用同一条状态条 ----
// 经 provide 传给分区子组件（AgentConfigCard 等），inject 同一实例——不各自实例化导致状态条分裂
const toast = useActionToast();
provide(ACTION_TOAST, toast);
provide(SKILL_TOAST, useActionToast({ msg: toast.msg }));
const { msg: testMsg, flash } = toast;

// ---- 桌宠输入授权（macOS 辅助功能）：状态留父级——save 契约的启停同步与窗口聚焦复查都要读写 ----
const petInputOn = useSettingToggle("pet_input_response");
/** macOS 辅助功能授权（输入响应的前提）；其他平台恒 true */
const inputPerm = ref(true);
/** 当前进程可执行文件路径（授权指引：辅助功能列表里要勾选的就是它） */
const inputExe = ref("");
/** 开关开着且未授权时拉一次路径（去授权按钮旁展示，可拖进/⌘⇧G 粘贴） */
watch(
  [petInputOn, inputPerm],
  ([on, perm]) => {
    if (on && !perm && !inputExe.value) {
      void api
        .petInputExe()
        .then((p) => (inputExe.value = p))
        .catch(() => {});
    }
  },
  { immediate: true },
);

/** 授权后免重启生效：窗口重新聚焦（用户从系统设置回来）时复查，
 *  已授权就拉起监听线程并收掉常驻提示——省掉「重启应用再试」这一步 */
async function recheckInputPerm() {
  if (!petInputOn.value || inputPerm.value) return;
  try {
    if (!(await api.petInputPermission())) return;
    inputPerm.value = true;
    await api.petInputSetEnabled(true);
    flash(t("focus.petInputGranted"));
  } catch {
    /* 非桌面环境静默 */
  }
}

/** 保存按钮提升到 App.vue 标题行右侧，经 ref 调用 */
async function saveSettings(msg?: string) {
  await settings.save(SETTING_KEYS);
  // 输入响应的后端监听线程跟随保存结果同步（幂等；macOS 未授权时弹系统
  // 授权对话框并提示——设置本身已保存，只有这个可选功能在等授权）
  if (petInputOn.value) {
    try {
      const r = await api.petInputSetEnabled(true);
      inputPerm.value = r !== "permission";
      if (r === "permission") testMsg.value = t("focus.petInputPermToast");
    } catch {
      /* 非桌面环境静默 */
    }
  } else {
    void api.petInputSetEnabled(false).catch(() => {});
  }
  flash(testMsg.value || msg || t("saved"));
}
defineExpose({ save: saveSettings });

// 设置分区选单（初代选项界面：上选单下内容）
const settingsTabs = [
  { key: "focus", labelKey: "stabs.focus" },
  { key: "cats", labelKey: "stabs.cats" },
  { key: "tags", labelKey: "stabs.tags" },
  { key: "display", labelKey: "stabs.display" },
  { key: "integrations", labelKey: "stabs.integrations" },
  { key: "diag", labelKey: "stabs.diag" },
  { key: "general", labelKey: "stabs.general" },
] as const;
const settingsTab = ref<(typeof settingsTabs)[number]["key"]>("focus");

// ---- 标签/维度编辑缓冲：留父级持有——懒加载 watch 的 !length 守卫依赖缓冲跨分区存活
//      （保留未保存的行内编辑），子组件 v-if 卸载会丢，故经 props 下发、reload 回调重拉 ----
interface EditingTag {
  id: number;
  name: string;
  description: string;
  dimension: string;
}
const editingTags = ref<EditingTag[]>([]);
function startEditTags() {
  editingTags.value = tagsStore.list.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    dimension: g.dimension || "topic",
  }));
}
const editingDims = ref<{ id: number; key: string; name: string; maxTags: number; enabled: boolean }[]>([]);
function startEditDims() {
  editingDims.value = tagsStore.dimensions.map((d) => ({
    id: d.id,
    key: d.key,
    name: d.name,
    maxTags: d.maxTags,
    enabled: d.enabled,
  }));
}

// ---- 飞书用户授权（lark-cli 登录态，凭证由 lark-cli 保管）：页面挂载即预取，
//      进入 integrations 分区时状态已就绪不闪「未授权」；授权忙位独立于 testing，文案共用底部状态条 ----
const feishuAuth = ref<FeishuOauthStatus | null>(null);
const oauthToast = useActionToast({ msg: toast.msg });
const oauthBusy = oauthToast.busy;

async function loadFeishuAuth() {
  try {
    feishuAuth.value = await api.feishuOauthStatus();
  } catch {
    feishuAuth.value = null; // 非桌面环境（E2E mock）静默
  }
}
async function feishuLogin() {
  await oauthToast.run(t("feishu.authing"), async () => {
    // 在系统终端里跑 lark-cli 登录（首次会先 config init 创建应用）
    const message = await api.feishuOauthLogin();
    await loadFeishuAuth();
    return message;
  });
}

// ---- 开机自启：页面挂载即预取（进入 general 分区时开关不闪跳），动作经 emit 回这里执行 ----
const autostart = ref(false);
async function loadAutostart() {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    autostart.value = await isEnabled();
  } catch {
    autostart.value = false;
  }
}
async function onAutostart(v: boolean | string | number) {
  autostart.value = Boolean(v);
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  if (autostart.value) {
    await enable();
  } else {
    await disable();
  }
}

// ---- 备份列表：页面挂载即预取；备份/恢复/导入动作与瞬时反馈随 BackupCard / ExportImportCard ----
const backups = ref<BackupInfo[]>([]);
const backupsLoaded = ref(false);
async function loadBackups() {
  try {
    backups.value = await api.listBackups();
  } catch {
    /* 非桌面环境静默 */
  } finally {
    backupsLoaded.value = true;
  }
}

// ---- 自动更新（反馈位独立于底部状态条：文案渲染在更新卡片内；下载进度经 tauri 事件
//      跨分区持续推送，忙位跨分区存活，故检查/安装动作也留父级经 emit 触发） ----
const updateToast = useActionToast();
const { busy: updating, msg: updateMsg } = updateToast;
const appVersion = ref("");
async function checkUpdate() {
  await updateToast.run(t("update.checking"), async () => {
    const v = await api.checkUpdate();
    return v ? t("update.found", { v }) : t("update.upToDate");
  });
}
async function installUpdate() {
  updating.value = true;
  updateMsg.value = t("update.installing");
  try {
    await api.installUpdate();
  } catch (e) {
    updateMsg.value = `❌ ${errorMessage(e)}`;
    updating.value = false;
  }
  // 成功路径应用会自动重启，无需恢复状态
}

/** 分区懒加载：进入分区才拉对应数据。
 *  cats 分类/台词与 diag 健康/日志原实现每次进入都无条件重拉（无未保存保留语义），
 *  随各分区组件 onMounted 等价承接（v-if 装配下每次进入都重新挂载）；tags 缓冲有
 *  !length 守卫（保留未保存编辑）、agents 数据在 store——这两处留在父级 watch。 */
watch(settingsTab, (tab) => {
  if (tab === "tags") {
    if (!editingTags.value.length) startEditTags();
    if (!editingDims.value.length) startEditDims();
    if (!agentsStore.list.length) agentsStore.load(); // 项目派发卡片的 agent 下拉要用
  }
  if (tab === "integrations" && !agentsStore.list.length) agentsStore.load();
  if (tab === "integrations") agentsStore.loadTunnelStatuses();
});

// 诊断分区引用：链路健康变化事件到达时若停在诊断页，经分区壳转发刷新健康面板
// （v-if 装配下「已挂载」⟺「settingsTab === 'diag'」，未挂载时 ref 为空自然跳过）
const diagSection = ref<InstanceType<typeof SectionDiag>>();

const unlisteners: UnlistenFn[] = [];
// 用户去系统设置勾选辅助功能后切回来：复查并自动拉起输入响应（配对清理防重复挂载）
const onWinFocus = () => void recheckInputPerm();
onMounted(async () => {
  window.addEventListener("focus", onWinFocus);
  await loadAutostart();
  await loadFeishuAuth();
  await loadBackups();
  try {
    inputPerm.value = await api.petInputPermission();
  } catch {
    /* 非桌面环境（E2E mock 未提供）按已授权显示 */
  }
  try {
    appVersion.value = await getVersion();
  } catch {
    /* 非桌面环境（E2E mock 未提供）静默 */
  }
  // 下载进度（Rust install_update 边下边推）
  unlisteners.push(
    await listen<{ downloaded: number; total: number }>(EVENTS.updateProgress, (e) => {
      if (e.payload.total > 0) {
        updateMsg.value = t("update.progress", {
          pct: Math.round((e.payload.downloaded / e.payload.total) * 100),
        });
      }
    }),
  );
  // 链路健康变化（后台轮询成功/失败）→ 停在诊断页时跟随刷新
  unlisteners.push(
    await listen(EVENTS.integrationHealthChanged, () => {
      if (settingsTab.value === "diag") diagSection.value?.reloadHealth();
    }),
  );
});
onUnmounted(() => {
  window.removeEventListener("focus", onWinFocus);
  unlisteners.forEach((u) => u());
});
</script>

<template>
  <div class="settings">
    <div class="set-body">
      <nav class="settings-tabs">
        <button
          v-for="st in settingsTabs"
          :key="st.key"
          class="stab"
          :class="{ active: settingsTab === st.key }"
          @click="settingsTab = st.key"
        >
          <span class="cursor">▶</span>{{ t(st.labelKey) }}
        </button>
      </nav>

      <SectionFocus v-if="settingsTab === 'focus'" :input-perm="inputPerm" :input-exe="inputExe" />
      <SectionCats v-if="settingsTab === 'cats'" />
      <SectionTags
        v-if="settingsTab === 'tags'"
        :editing-tags="editingTags"
        :editing-dims="editingDims"
        :reload-tags="startEditTags"
        :reload-dims="startEditDims"
      />
      <SectionDisplay v-if="settingsTab === 'display'" />
      <SectionIntegrations
        v-if="settingsTab === 'integrations'"
        :feishu-auth="feishuAuth"
        :oauth-busy="oauthBusy"
        @login="feishuLogin"
      />
      <SectionDiag v-if="settingsTab === 'diag'" ref="diagSection" />
      <SectionGeneral
        v-if="settingsTab === 'general'"
        :autostart="autostart"
        :app-version="appVersion"
        :latest-version="latestVersion"
        :updating="updating"
        :update-msg="updateMsg"
        :backups="backups"
        :backups-loaded="backupsLoaded"
        :reload-backups="loadBackups"
        @autostart="onAutostart"
        @check-update="checkUpdate"
        @install-update="installUpdate"
      />
    </div>

    <!-- 底部固定：测试/错误信息 -->
    <div class="set-status">
      <span v-if="testMsg" class="test-msg">{{ testMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 设置：顶部保存栏 + 滚动内容 + 底部状态栏 */
.settings {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* 滚动容器占满主区宽度，滚动条贴住窗口右缘；限宽只约束内部内容列 */
.set-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 20px 20px;
}
/* 跟随窗口伸缩，超过阅读舒适宽度后收口居中（水平留白移到 .set-body 的 padding）；
 * 各分区卡片的限宽副本随分区组件（.set-card scoped 样式无法跨组件生效） */
/* 设置分区选单：初代菜单样式 */
.settings-tabs {
  width: 100%;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--dex-navy);
  padding: 10px;
}
.stab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 3px solid var(--dex-navy);
  border-radius: 8px;
  background: var(--dex-body);
  font-size: 14px;
  font-weight: 700;
  padding: 8px 12px;
  min-height: 38px;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 3px 3px 0 var(--dex-navy);
  transition:
    transform var(--t-tap),
    box-shadow var(--t-tap),
    background var(--t-tap);
}
.stab .cursor {
  width: 12px;
  flex: none;
  opacity: 0;
  font-size: 10px;
}
.stab:hover:not(.active) {
  background: var(--hover);
}
.stab.active {
  background: var(--poke-yellow);
}
.stab.active .cursor {
  opacity: 1;
}
.stab:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--dex-navy);
}
/* 底部状态栏：常驻高度避免消息出现时内容跳动 */
.set-status {
  min-height: 26px;
  padding: 4px 20px 8px;
  display: flex;
  align-items: center;
}
.test-msg {
  font-size: 13px;
  font-weight: 700;
  color: var(--danger);
}
</style>
