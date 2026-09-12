import type { Window } from "@tauri-apps/api/window";

/**
 * 从 PetApp 抽出的手动拖拽（Linux/WebKit 下 data-tauri-drag-region 不可靠）。
 * 移动超过阈值才算拖拽，否则视为点击——避免拖拽吞掉精灵的 click 事件。
 */
export function usePetDrag(petWindow: Window) {
  let pressX = 0;
  let pressY = 0;
  let dragging = false;
  let dragStarted = false;

  const onDragStart = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".quick-dex") || target.closest(".switcher")) return;
    if (e.button !== 0) return;
    pressX = e.screenX;
    pressY = e.screenY;
    dragging = true;
    dragStarted = false;
  };

  const onDragMove = (e: MouseEvent) => {
    if (!dragging || dragStarted) return;
    if (Math.abs(e.screenX - pressX) > 4 || Math.abs(e.screenY - pressY) > 4) {
      dragStarted = true;
      petWindow.startDragging();
    }
  };

  const onDragEnd = () => {
    dragging = false;
  };

  return { onDragStart, onDragMove, onDragEnd };
}
