import { getCurrentScope, onScopeDispose, ref, type InjectionKey, type Ref } from "vue";
import { errorMessage } from "../api";

/**
 * 设置页动作反馈条（原 SettingsTab 各处 testMsg/testing 样板的收敛）：
 * 忙位 + 状态文案 + 两类动作外壳——flash（写文案 + 定时自动清除）与
 * run（busy → 提示文案 → try/finally 恢复 + 错误写 ❌ 前缀文案）。
 */
export interface ActionToast {
  /** 动作进行中（按钮 :disabled 绑定） */
  busy: Ref<boolean>;
  /** 状态条文案（空串 = 无消息） */
  msg: Ref<string>;
  /** 设置文案并 ms 毫秒后自动清除（默认 2000ms；重复调用重置上一个清除定时器） */
  flash(text: string, ms?: number): void;
  /**
   * 动作外壳：busy 置位 → busyLabel 提示（空串则不动文案）→ fn 返回的字符串进状态条、
   * 抛错写 `❌ <错误文案>` → finally 恢复 busy。fn 返回 void 时成功路径不动文案。
   */
  run(busyLabel: string, fn: () => Promise<string | void>): Promise<void>;
}

/**
 * 可传入外部 busy/msg 复用：独立忙位但要共用同一条状态条的场合（技能检查/飞书授权）
 * 传 `{ msg }`；父子组件共用同一实例时经 ACTION_TOAST / SKILL_TOAST provide/inject 传递，
 * 不要各自实例化导致状态条分裂。
 */
export function useActionToast(shared?: { busy?: Ref<boolean>; msg?: Ref<string> }): ActionToast {
  const busy = shared?.busy ?? ref(false);
  const msg = shared?.msg ?? ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flash(text: string, ms = 2000): void {
    msg.value = text;
    clearTimeout(timer);
    timer = setTimeout(() => (msg.value = ""), ms);
  }

  async function run(busyLabel: string, fn: () => Promise<string | void>): Promise<void> {
    busy.value = true;
    if (busyLabel) msg.value = busyLabel;
    try {
      const text = await fn();
      if (typeof text === "string") msg.value = text;
    } catch (e) {
      msg.value = `❌ ${errorMessage(e)}`;
    } finally {
      busy.value = false;
    }
  }

  // 组件卸载 / 作用域销毁时清掉未触发的清除定时器（无泄漏）
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(timer));

  return { busy, msg, flash, run };
}

/** 主状态条（页面底部）：testing 忙位 + testMsg 文案 */
export const ACTION_TOAST: InjectionKey<ActionToast> = Symbol("action-toast");
/** 技能检查/安装：独立 skillBusy 忙位（不锁测试按钮），文案共用主状态条 */
export const SKILL_TOAST: InjectionKey<ActionToast> = Symbol("skill-toast");
