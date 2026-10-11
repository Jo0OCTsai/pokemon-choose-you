/**
 * a11y 四条可测断言（UIUX §6.2）：① 瞬态反馈 role=status + aria-live=polite；② 抽屉/
 * 弹层 focus trap + Esc + 焦点回归；③ 置信档位与健康状态非颜色冗余；④ 自组合控件命中
 * 区 ≥32px（对交付 CSS 源断言——happy-dom 无布局，计算样式不可读）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { ConfirmDialog, Modal } from "../../src/client/ui/Modal";
import { StatusDot } from "../../src/client/ui/controls";
import { UndoToast, UNDO_WINDOW_MS } from "../../src/client/ui/Toast";
import { SuggestionCard } from "../../src/client/radio/SuggestionCard";
import { mockHost } from "../../src/client/rpc";
import { makeMessage } from "./fixtures";

afterEach(cleanup);

describe("① 瞬态反馈 role=status + aria-live=polite", () => {
  it("撤销 toast 具备 role=status 与 aria-live=polite（读屏可感知、不打断）", () => {
    const host = mockHost();
    render(
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <UndoToast toast={{ message: "已捕捉「x」", onUndo: () => undefined }} onClose={() => undefined} />
        </I18nProvider>
      </ClientProvider>,
    );
    const toast = screen.getByTestId("undo-toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    // 不抢焦点：toast 容器内无自动 focus、按钮非 autofocus
    expect(toast.querySelector("[autofocus]")).toBeNull();
    expect(document.activeElement === toast).toBe(false);
  });

  it("撤销窗口常量 = 5 秒（捕捉/放生共用范式）", () => {
    expect(UNDO_WINDOW_MS).toBe(5000);
  });
});

describe("② 弹层 focus trap + Esc + 焦点回归", () => {
  it("Modal：打开聚焦首个可聚焦元素、Tab 循环、Esc 关闭、焦点回归触发元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "触发";
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    render(
      <I18nProvider locale="zh-Hans">
        <Modal
          title="确认"
          actions={[
            { label: "取消", onChoose: onClose },
            { label: "确认", onChoose: onClose, variant: "primary" },
          ]}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("ConfirmDialog：两键齐全且 Esc = 取消语义", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nProvider locale="zh-Hans">
        <ConfirmDialog
          title="放生"
          body="级联说明"
          confirmLabel="确认放生"
          onCancel={onCancel}
          onConfirm={onConfirm}
          danger
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("③ 置信档位与健康状态非颜色冗余", () => {
  it("建议卡置信三档：边框形色（data-confidence）+ 行内文字档位标（高/中/低置信）", () => {
    const host = mockHost();
    const card = (confidence: "high" | "medium" | "low") => (
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <SuggestionCard
            message={makeMessage({ messageId: `c-${confidence}`, confidence })}
            readonly={false}
            onChanged={() => undefined}
          />
        </I18nProvider>
      </ClientProvider>
    );
    const labels = { high: "高置信", medium: "中置信", low: "低置信" };
    for (const confidence of ["high", "medium", "low"] as const) {
      cleanup();
      render(card(confidence));
      const node = screen.getByTestId("suggestion-card");
      expect(node.getAttribute("data-confidence")).toBe(confidence);
      expect(screen.getByText(labels[confidence])).toBeTruthy();
    }
  });

  it("状态点旁必有文字状态（正常/重试中/未授权），色觉不依赖", () => {
    for (const [level, text] of [
      ["ok", "正常"],
      ["warn", "重试中"],
      ["fail", "未授权"],
    ] as const) {
      cleanup();
      render(<StatusDot level={level} text={text} />);
      const textNode = screen.getByText(text);
      const row = textNode.parentElement as HTMLElement;
      expect(row.querySelector("[data-level]")).toBeTruthy();
      expect(textNode.textContent).toBe(text);
    }
  });
});

describe("④ 命中区 ≥32px（对交付 CSS 源断言）", () => {
  const clientDir = join(__dirname, "../../src/client");

  function css(name: string): string {
    return readFileSync(join(clientDir, name), "utf8");
  }

  it("共享控件（按钮/开关/选择器/输入）≥32px（composes 继承基类尺寸）", () => {
    const ui = css("ui/ui.module.css");
    for (const cls of [
      ".button",
      ".buttonPrimary",
      ".buttonDanger",
      ".toggle",
      ".select",
      ".input",
      ".undoToastButton",
    ]) {
      const block = cssBlock(ui, cls);
      expect(block, `${cls} 缺失`).toBeTruthy();
      expect(minSize(effective(ui, cls)), `${cls} 命中区不足 32px`).toBeGreaterThanOrEqual(32);
    }
  });

  it("分段导航 / 分区选单 / chip 按钮 / 三态组 / 建议卡复选与标签接受 ≥32px", () => {
    const checks: Array<[string, string[]]> = [
      ["app/app.module.css", [".segmentButton"]],
      ["settings/settings.module.css", [".sectionNavButton", ".saveButton", ".triStateButton", ".pokeResultRow"]],
      ["radio/radio.module.css", [".selectCheckbox", ".tagProposalAccept"]],
      ["chip/chip.module.css", [".chip", ".chipButton"]],
      ["tasks/tasks.module.css", [".filterButton", ".taskCard"]],
    ];
    for (const [file, classes] of checks) {
      const source = css(file);
      for (const cls of classes) {
        const block = cssBlock(source, cls);
        expect(block, `${file} ${cls} 缺失`).toBeTruthy();
        expect(minSize(effective(source, cls)), `${file} ${cls} 命中区不足 32px`).toBeGreaterThanOrEqual(32);
      }
    }
  });
});

/** 取 CSS 类声明块（至下一个顶级选择器） */
function cssBlock(source: string, cls: string): string {
  const start = source.indexOf(`${cls} {`);
  if (start < 0) {
    return "";
  }
  const end = source.indexOf("}", start);
  return source.slice(start, end);
}

/** 展开块：composes 声明合并基类（CSS Modules 组合语义） */
function effective(source: string, cls: string): string {
  const block = cssBlock(source, cls);
  const composed = /composes:\s*(\w+)/.exec(block);
  if (composed === null) {
    return block;
  }
  return `${block}\n${cssBlock(source, `.${composed[1]}`)}`;
}

/** 解析块内 min-height/min-width 的最小值（px） */
function minSize(block: string): number {
  const heights = [...block.matchAll(/min-(?:height|width)\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
  if (heights.length === 0) {
    const height = /(?:^|;)\s*(?:height|width)\s*:\s*(\d+)px/.exec(block);
    return height === null ? 0 : Number(height[1]);
  }
  return Math.min(...heights);
}
