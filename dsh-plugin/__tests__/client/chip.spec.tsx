/**
 * conversation chip：四态（无进行中零占位 / 运行 ⏸✔ / 暂停 ▶🍦✔ / 短休息 ☕▶ 不含✔）+
 * 就近控制命令面 + 点击主体 onOpenPage（host:pageOpen 语义）+ 只读传播置灰。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { ConversationChip } from "../../src/client/chip/ConversationChip";
import { makeTask } from "./fixtures";

afterEach(cleanup);

function renderChip(
  props: Partial<React.ComponentProps<typeof ConversationChip>> & {
    task?: React.ComponentProps<typeof ConversationChip>["task"];
  },
) {
  const host = mockHost();
  const onOpenPage = vi.fn();
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <ConversationChip
          task={makeTask({ id: 1, status: "active", title: "核对周报" })}
          mode="running"
          secondsLeft={1499}
          pokemonName="皮卡丘"
          onOpenPage={onOpenPage}
          {...props}
        />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onOpenPage };
}

describe("ConversationChip 四态", () => {
  it("无进行中任务零占位（不渲染任何节点）", () => {
    const { container } = render(
      <ClientProvider client={mockHost()}>
        <I18nProvider locale="zh-Hans">
          <ConversationChip task={null} mode="running" secondsLeft={0} pokemonName="" />
        </I18nProvider>
      </ClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("运行态：皮卡丘 捕获中 · 24:59 ⏸✔；⏸/✔ 调 taskPause/taskComplete", async () => {
    const { host } = renderChip({});
    const chip = screen.getByTestId("conversation-chip");
    expect(chip.textContent).toContain("皮卡丘 捕获中");
    expect(chip.textContent).toContain("24:59"); // 定宽数字
    expect(chip.querySelectorAll("button")).toHaveLength(4); // 主体 + ⏸ + ✔ + ↗
    fireEvent.click(screen.getByLabelText("⏸ 暂停"));
    await Promise.resolve();
    expect(host.calls.map((c) => c.command)).toContain("taskPause");
    fireEvent.click(screen.getByLabelText("完成捕捉"));
    await Promise.resolve();
    expect(host.calls.map((c) => c.command)).toContain("taskComplete");
  });

  it("暂停态：已暂停 mm:ss ▶🍦✔（▶ 继续 / 🍦 先试 5 分钟）", async () => {
    const { host } = renderChip({ mode: "paused", secondsLeft: 300 });
    expect(screen.getByTestId("conversation-chip").textContent).toContain("暂停");
    fireEvent.click(screen.getByLabelText("继续"));
    await Promise.resolve();
    expect(host.calls.map((c) => c.command)).toContain("taskResume");
    fireEvent.click(screen.getByLabelText(/就试 5 分钟/));
    await Promise.resolve();
    expect(host.calls.map((c) => c.command)).toContain("pomoTryFive");
  });

  it("短休息态：☕ 休息中 ▶——不含 ✔ 完成钮", () => {
    renderChip({ mode: "resting", secondsLeft: 120 });
    const chip = screen.getByTestId("conversation-chip");
    expect(chip.textContent).toContain("☕ 休息中");
    expect(chip.textContent).toContain("02:00");
    expect(screen.queryByLabelText("完成捕捉")).toBeNull();
    expect(screen.getByLabelText("继续")).toBeTruthy();
  });

  it("点击主体 → onOpenPage（可选目标分段）", () => {
    const { onOpenPage } = renderChip({ targetSection: "settings" });
    fireEvent.click(screen.getByTestId("chip-open"));
    expect(onOpenPage).toHaveBeenCalledWith("settings");
  });

  it("只读模式（DB_SCHEMA_TOO_NEW）：⏸/✔ 置灰", () => {
    renderChip({ readonly: true });
    expect(screen.getByLabelText("⏸ 暂停").hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("完成捕捉").hasAttribute("disabled")).toBe(true);
  });
});
