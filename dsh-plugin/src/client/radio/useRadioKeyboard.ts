/**
 * 收音机键盘流（U9：仅插件页面聚焦域内，不注册全局快捷键——桌面 RadioTab onKeydown
 * 同构）：J/K·方向键 移动选中、C 捕捉/应用更新、X 逃走（other 原因码）、F 强制捕捉；
 * 焦点在输入控件上时不劫持。移动与动作按键位拆纯函数（复杂度棘轮拆分）。
 */
import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import type { RadioMessage } from "../rpc";
import { isJudging, isSignal } from "../radio/MessageRow";
import type { HostClient } from "../rpc";

/** 选中移动：池内 ±1（越界夹取；未选中回落池首） */
export function moveSelection(pool: RadioMessage[], selectedId: string | null, forward: boolean): string | null {
  if (pool.length === 0) {
    return null;
  }
  const index = pool.findIndex((m) => m.messageId === selectedId);
  if (index < 0) {
    return pool[0].messageId;
  }
  const next = forward ? Math.min(pool.length - 1, index + 1) : Math.max(0, index - 1);
  return pool[next].messageId;
}

/** 焦点在输入控件上时不劫持按键（桌面 RadioTab 同款守卫） */
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches("input, textarea, select");
}

function isNavKey(key: string): boolean {
  return key === "j" || key === "arrowdown" || key === "k" || key === "arrowup";
}

/** 动作键（仅待处理且已判定消息）：C 捕捉/应用更新、X 逃走、F 强制捕捉；不匹配返回 false */
export function runActionKey(client: HostClient, message: RadioMessage, key: string, onActioned: () => void): boolean {
  if (message.reviewStatus !== "pending" || isJudging(message.aiStatus)) {
    return false;
  }
  return (
    catchAction(client, message, key, onActioned) ||
    escapeAction(client, message, key, onActioned) ||
    forceAction(client, message, key, onActioned)
  );
}

/** C：信号消息捕捉 / 应用更新（桌面 acceptIm 双分支同构） */
function catchAction(client: HostClient, message: RadioMessage, key: string, onActioned: () => void): boolean {
  if (key !== "c" || !isSignal(message)) {
    return false;
  }
  void (
    message.aiStatus === "update"
      ? client.reviewApplyUpdate({ messageId: message.messageId })
      : client.reviewAccept({ messageId: message.messageId })
  ).then(onActioned);
  return true;
}

/** X：逃走一步直发（other 原因码；none/followup 无逃走语义） */
function escapeAction(client: HostClient, message: RadioMessage, key: string, onActioned: () => void): boolean {
  if (key !== "x" || message.aiStatus === "none" || message.aiStatus === "followup") {
    return false;
  }
  void client.reviewDismiss({ messageId: message.messageId, reasonCode: "other" }).then(onActioned);
  return true;
}

/** F：强制捕捉（none/todo/error 人工拍板——桌面 F 键语义） */
function forceAction(client: HostClient, message: RadioMessage, key: string, onActioned: () => void): boolean {
  const forceable = message.aiStatus === "none" || message.aiStatus === "todo" || message.aiStatus === "error";
  if (key !== "f" || !forceable) {
    return false;
  }
  void client.forceCapture({ messageId: message.messageId }).then(onActioned);
  return true;
}

/** 键盘流 hook：绑定到分段容器 onKeyDown（事件冒泡自行内聚焦元素） */
export function useRadioKeyboard(args: {
  client: HostClient;
  pool: RadioMessage[];
  selectedId: string | null;
  selectedMessage: RadioMessage | null;
  setSelectedId: (id: string) => void;
  onActioned: () => void;
}): (event: KeyboardEvent<HTMLElement>) => void {
  const { client, pool, selectedId, selectedMessage, setSelectedId, onActioned } = args;
  return useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (isNavKey(key)) {
        event.preventDefault();
        const next = moveSelection(pool, selectedId, key === "j" || key === "arrowdown");
        if (next !== null) {
          setSelectedId(next);
        }
        return;
      }
      if (selectedMessage !== null && runActionKey(client, selectedMessage, key, onActioned)) {
        event.preventDefault();
      }
    },
    [client, pool, selectedId, selectedMessage, setSelectedId, onActioned],
  );
}
