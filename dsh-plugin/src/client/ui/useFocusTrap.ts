/**
 * focus trap 钩子（UIUX §6.2 a11y 断言②）：容器内 Tab 循环不出容器、Esc 关闭、
 * 关闭后焦点回归触发元素。抽屉与确认弹层共用。
 */
import { useEffect, type RefObject } from "react";

function focusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return [...nodes].filter((n) => !n.hasAttribute("hidden") && n.getAttribute("aria-hidden") !== "true");
}

/**
 * @param containerRef 陷阱容器
 * @param active 激活标志（false 时不动焦点）
 * @param onEscape Esc 回调（一般 = 关闭）
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    if (container !== null) {
      const focusables = focusableElements(container);
      (focusables[0] ?? container).focus();
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
        return;
      }
      const node = containerRef.current;
      if (event.key === "Tab" && node !== null) {
        const focusables = focusableElements(node);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [containerRef, active, onEscape]);
}
