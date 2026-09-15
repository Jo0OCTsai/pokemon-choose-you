import { getCurrentWindow, cursorPosition } from "@tauri-apps/api/window";

/**
 * 透明窗口点击穿透：桌宠窗口是整块矩形，精灵两侧、快捷屏收起后的下方都是透明像素，
 * 但窗口仍会接住鼠标、挡住下层应用。这里按「光标下是否是实体元素」动态切换：
 * - 窗口接收事件时：mousemove 命中检测，落在空白处 → setIgnoreCursorEvents(true) 放行
 * - 穿透后窗口收不到鼠标事件：轮询全局光标位置换算回窗口内坐标，回到实体元素上再恢复
 *
 * 命中检测依赖 .pet-stage 的 pointer-events:none（见 PetApp 样式）：
 * elementFromPoint 会跳过 pointer-events:none 的元素，空白处直接落到 body。
 * 按住鼠标（拖拽判定窗口期）时不开启穿透，避免打断 startDragging。
 */
export function usePetClickThrough() {
  const win = getCurrentWindow();
  let ignoring = false;
  let stopped = false;
  const timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    if (!stopped && ignoring) void pollRestore();
  }, 60);

  /** 窗口内 CSS 坐标是否落在实体内容上：只认桌宠舞台内的元素与右键菜单
   *  （菜单 Teleport 到 body，不在舞台树里）。舞台外的任何命中（#app、body）
   *  都说明该点是透明空白。 */
  function hitSolid(x: number, y: number): boolean {
    const el = document.elementFromPoint(x, y);
    return !!el && !!el.closest(".pet-stage, .ctx-menu");
  }

  async function setIgnore(v: boolean) {
    if (ignoring === v) return;
    ignoring = v;
    try {
      await win.setIgnoreCursorEvents(v);
    } catch {
      // 设置失败（极端时序）保持现状，下一轮事件/轮询再试
      ignoring = !v;
    }
  }

  async function pollRestore() {
    try {
      const [cursor, origin, factor] = await Promise.all([cursorPosition(), win.outerPosition(), win.scaleFactor()]);
      if (hitSolid((cursor.x - origin.x) / factor, (cursor.y - origin.y) / factor)) {
        await setIgnore(false);
      }
    } catch {
      // 窗口查询失败（隐藏/关闭竞态）下轮再试
    }
  }

  function onMove(e: MouseEvent) {
    if (stopped || e.buttons !== 0) return; // 按住鼠标 = 可能要拖拽，不穿透
    if (!hitSolid(e.clientX, e.clientY)) void setIgnore(true);
  }

  window.addEventListener("mousemove", onMove, { passive: true });

  /** 停用并恢复接收事件（组件卸载时调用） */
  return function dispose() {
    stopped = true;
    window.removeEventListener("mousemove", onMove);
    if (timer) clearInterval(timer);
    void setIgnore(false);
  };
}
