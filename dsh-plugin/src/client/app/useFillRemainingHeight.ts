/**
 * 收音机/背包段体填充窗口剩余高度钩子（从 PluginDetailPage.tsx 拆出——棘轮
 * max-lines，等量迁移）：段体顶缘实测 → --pcy-remaining（详见原文件注释口径）。
 */
import { useEffect } from "react";

/**
 * 收音机/背包段填充窗口剩余高度（#1 验收口径：整页高度恒等于滚动容器内容盒剩余高，
 * 展开消息不撑页、收发报条常驻可视；背包段同口径——页头/七段选单/分区选单行固定，
 * 滚动只在分区页内容）：--pcy-remaining = 最近滚动容器内容盒底缘 − 段体顶缘（实测——
 * 主面板壳 padding / darwin 红绿灯避让 / 宿主 chrome 高度不定，按 100dvh 算会高出壳
 * 内容区出滚动条）。挂载/切段/窗口尺寸变化时重算；失活时清属性交还文档流。
 */
export function useFillRemainingHeight(ref: React.RefObject<HTMLDivElement | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!active || el === null) {
      return;
    }
    const update = (): void => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top));
      const scroller = scrollParentOf(el);
      let bottom: number;
      if (scroller === null) {
        bottom = document.documentElement.clientHeight;
      } else {
        const rect = scroller.getBoundingClientRect();
        const cs = window.getComputedStyle(scroller);
        const pad = Number.parseFloat(cs.paddingBottom) || 0;
        const border = Number.parseFloat(cs.borderBottomWidth) || 0;
        bottom = rect.bottom - border - pad;
      }
      el.style.setProperty("--pcy-remaining", `${Math.max(0, Math.round(bottom - top))}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      el.style.removeProperty("--pcy-remaining");
    };
  }, [active, ref]);
}

/** 最近的可滚动祖先（overflow-y auto/scroll；无 → null 回落视口口径——detail 区等文档流面） */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node !== null) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
