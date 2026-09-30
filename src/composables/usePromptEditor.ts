import { computed, getCurrentScope, onScopeDispose, reactive, ref } from "vue";
import { api } from "../api";
import type { PromptSpecInfo, SavePromptResult } from "../types";

/**
 * AI 提示词编辑器（设置页「AI 提示词」卡）：specs 装载、三态映射、编辑缓冲与脏检查、
 * 前端预校验、保存/恢复默认状态机。校验单源在后端——这里只做 spec 字段可直接推导的
 * 防呆项（长度 / 必要占位符包含 / 空白与同默认的中性预告），未知占位符仅展示后端
 * 返回的警告清单，不在前端扫描（扫描规则双端实现会漂移，AD §4.2.2）。
 * 保存成功用响应 spec 直接替换面板数据，前端零推导；空白保存与恢复默认共用同一
 * save(key, "") 路径（后端删行）。面板级缓冲：折叠/展开不丢，随卡卸载丢弃。
 */

/** 前端预校验/呈现问题（kind → i18n 键与分级渲染由组件完成） */
export type PromptIssue =
  | { kind: "missing"; names: string[] } // 阻断：缺必要占位符
  | { kind: "overlong"; count: number; limit: number } // 阻断：超长度上限
  | { kind: "blank" } // 中性：空白保存 = 恢复默认
  | { kind: "sameDefault" } // 中性：与内置默认一致 = 视为未自定义
  | { kind: "unknown"; names: string[] } // 警告：后端返回的未知占位符清单
  | { kind: "saveFailed"; message: string }; // 阻断红呈现：后端 Invalid / 调用失败文案（原样呈现）

/** 校验区分级着色（阻断红 / 警告黄 / 中性灰；saveFailed 是错误呈现不参与保存禁用） */
export function promptIssueLevel(issue: PromptIssue): "block" | "warn" | "info" {
  switch (issue.kind) {
    case "missing":
    case "overlong":
    case "saveFailed":
      return "block";
    case "unknown":
      return "warn";
    default:
      return "info";
  }
}

/** 会阻断保存的预校验项（后端兜底复验之外的常态拦截） */
function isBlocking(issue: PromptIssue): boolean {
  return issue.kind === "missing" || issue.kind === "overlong";
}

export interface PromptEditorDeps {
  /** 装载（缺省走 api.listAiPromptSpecs；测试注入 fake） */
  load?: () => Promise<PromptSpecInfo[]>;
  /** 保存（缺省走 api.saveAiPrompt） */
  save?: (key: string, value: string) => Promise<SavePromptResult>;
}

/** 单功能面板的全部状态与操作（reactive：模板/测试直接 .editing/.draft 取值） */
export interface PromptPanelState {
  id: string;
  spec: PromptSpecInfo;
  editing: boolean;
  draft: string;
  dirty: boolean;
  saving: boolean;
  confirming: boolean;
  /** 校验/呈现问题清单（查看态只可能出现 unknown / saveFailed） */
  issues: PromptIssue[];
  canSave: boolean;
  /** 已存覆盖行存在（custom 与 default_warned 都算）——「恢复默认…」入口可见性 */
  hasOverride: boolean;
  /** 当前生效文本（custom = 覆盖原文；default / default_warned = 内置默认） */
  effectiveText: string;
  /** 编辑缓冲字符数（code points，[...str] 口径与后端对齐） */
  charCount: number;
  /** 4s 自隐提示：saved（保存成功）/ restored（恢复成功） */
  hint: "saved" | "restored" | null;
  /** 编辑缓冲写入口（组件 v-model 桥用；composable 自持状态） */
  setDraft(value: string): void;
  startEdit(): void;
  cancelEdit(): void;
  save(): Promise<boolean>;
  requestRestore(): void;
  cancelRestore(): void;
  confirmRestore(): Promise<boolean>;
}

const HINT_MS = 4_000;

type SaveFn = (key: string, value: string) => Promise<SavePromptResult>;
/** 4s 提示定时器登记表（卡卸载时统一清理） */
type HintTimers = Set<ReturnType<typeof setTimeout>>;

/** 编辑缓冲的即时预校验（空白时不叠占位符/超长噪音；同默认预告只对已自定义的功能有意义——本来就是默认时再输入等值文本不算变化） */
function draftIssues(text: string, spec: PromptSpecInfo, charCount: number): PromptIssue[] {
  if (text.trim() === "") return [{ kind: "blank" }];
  const out: PromptIssue[] = [];
  const missing = spec.requiredPlaceholders.filter((p) => !text.includes(p));
  if (missing.length) out.push({ kind: "missing", names: missing });
  if (charCount > spec.lengthLimit) out.push({ kind: "overlong", count: charCount, limit: spec.lengthLimit });
  if (text === spec.defaultText && spec.source !== "default") out.push({ kind: "sameDefault" });
  return out;
}

/** 4s 自隐提示 + 定时器登记（跨次提示复用同一登记表，重入先清旧定时器） */
function createHintFlasher(hintTimers: HintTimers) {
  const hint = ref<"saved" | "restored" | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flash(kind: "saved" | "restored") {
    hint.value = kind;
    if (timer !== null) {
      clearTimeout(timer);
      hintTimers.delete(timer);
    }
    const next = setTimeout(() => {
      hint.value = null;
      hintTimers.delete(next);
      if (timer === next) timer = null;
    }, HINT_MS);
    timer = next;
    hintTimers.add(next);
  }
  return { hint, flash };
}

function createPanelState(initial: PromptSpecInfo, hintTimers: HintTimers) {
  const spec = ref(initial);
  const editing = ref(false);
  const draft = ref("");
  const baseline = ref("");
  const saving = ref(false);
  const confirming = ref(false);
  const saveError = ref<string | null>(null);
  const unknownPlaceholders = ref<string[]>([]);
  const { hint, flash } = createHintFlasher(hintTimers);
  const charCount = computed(() => [...draft.value].length);
  const dirty = computed(() => editing.value && draft.value !== baseline.value);
  const issues = computed<PromptIssue[]>(() => [
    ...(editing.value ? draftIssues(draft.value, spec.value, charCount.value) : []),
    ...(unknownPlaceholders.value.length ? [{ kind: "unknown" as const, names: unknownPlaceholders.value }] : []),
    ...(saveError.value !== null ? [{ kind: "saveFailed" as const, message: saveError.value }] : []),
  ]);
  const canSave = computed(() => editing.value && !saving.value && !issues.value.some(isBlocking));
  const hasOverride = computed(() => spec.value.overrideText !== null);
  const effectiveText = computed(() =>
    spec.value.source === "custom" ? (spec.value.overrideText ?? spec.value.defaultText) : spec.value.defaultText,
  );
  return {
    spec,
    editing,
    draft,
    baseline,
    saving,
    confirming,
    saveError,
    unknownPlaceholders,
    dirty,
    issues,
    canSave,
    hasOverride,
    effectiveText,
    charCount,
    hint,
    flash,
  };
}

/** 面板可变状态集（refs + computeds；保存流程与 reactive 装配的共享面） */
type PanelState = ReturnType<typeof createPanelState>;

/** 提交与恢复共用的保存路径：成功以响应 spec 直接替换面板数据（前端零推导） */
function createSaveFlow(st: PanelState, saveFn: SaveFn) {
  async function commit(value: string, okHint: "saved" | "restored"): Promise<boolean> {
    const key = st.spec.value.storageKey;
    if (key === null) return false;
    st.saving.value = true;
    st.saveError.value = null;
    try {
      const r = await saveFn(key, value);
      st.spec.value = r.spec;
      st.unknownPlaceholders.value = r.unknownPlaceholders;
      st.editing.value = false;
      st.draft.value = "";
      st.baseline.value = "";
      if (okHint === "restored") st.confirming.value = false;
      st.flash(okHint);
      return true;
    } catch (e) {
      // 后端兜底复验（Invalid）与调用失败：文案原样呈现，编辑态与缓冲保留
      st.saveError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      st.saving.value = false;
    }
  }
  return {
    async save(): Promise<boolean> {
      if (!st.canSave.value) return false;
      return await commit(st.draft.value, "saved");
    },
    requestRestore(): void {
      st.confirming.value = true;
    },
    cancelRestore(): void {
      st.confirming.value = false;
    },
    async confirmRestore(): Promise<boolean> {
      if (st.saving.value) return false;
      return await commit("", "restored");
    },
  };
}

/** 保存/恢复状态机（提交与恢复共用的保存路径 + 两步确认位操作） */
type PanelFlow = ReturnType<typeof createSaveFlow>;

/** reactive 装配：refs/computeds 解包为面板字段，编辑会话方法闭包直读状态 */
function assemblePanel(initial: PromptSpecInfo, st: PanelState, flow: PanelFlow): PromptPanelState {
  return reactive({
    id: initial.id,
    spec: st.spec,
    editing: st.editing,
    draft: st.draft,
    dirty: st.dirty,
    saving: st.saving,
    confirming: st.confirming,
    issues: st.issues,
    canSave: st.canSave,
    hasOverride: st.hasOverride,
    effectiveText: st.effectiveText,
    charCount: st.charCount,
    hint: st.hint,
    setDraft(value: string) {
      st.draft.value = value;
    },
    /** 进入编辑：预填已存覆盖原文（不可用覆盖也回填供修复），无覆盖预填生效文本（= 内置默认） */
    startEdit() {
      if (!st.spec.value.editable) return;
      st.draft.value = st.spec.value.overrideText ?? st.spec.value.defaultText;
      st.baseline.value = st.draft.value;
      st.saveError.value = null;
      st.unknownPlaceholders.value = [];
      st.editing.value = true;
    },
    /** 取消编辑：丢弃缓冲回查看态（已保存内容不受影响） */
    cancelEdit() {
      st.editing.value = false;
      st.draft.value = "";
      st.baseline.value = "";
      st.saveError.value = null;
      st.unknownPlaceholders.value = [];
    },
    save: flow.save,
    requestRestore: flow.requestRestore,
    cancelRestore: flow.cancelRestore,
    confirmRestore: flow.confirmRestore,
  });
}

function createPanel(initial: PromptSpecInfo, saveFn: SaveFn, hintTimers: HintTimers): PromptPanelState {
  const st = createPanelState(initial, hintTimers);
  return assemblePanel(initial, st, createSaveFlow(st, saveFn));
}

export function usePromptEditor(deps: PromptEditorDeps = {}) {
  const load = deps.load ?? (() => api.listAiPromptSpecs());
  const saveFn = deps.save ?? ((key: string, value: string) => api.saveAiPrompt(key, value));

  const loading = ref(false);
  const loadError = ref<string | null>(null);
  const panels = ref<PromptPanelState[]>([]);

  // 4s 提示定时器登记：卡卸载时统一清理（组件作用域外直接调用则跳过注册）
  const hintTimers: HintTimers = new Set();
  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const t of hintTimers) clearTimeout(t);
      hintTimers.clear();
    });
  }

  async function reload(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    try {
      const loaded = await load();
      panels.value = loaded.map((s) => createPanel(s, saveFn, hintTimers));
    } catch (e) {
      panels.value = [];
      loadError.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  void reload();
  return { loading, loadError, panels, reload };
}
