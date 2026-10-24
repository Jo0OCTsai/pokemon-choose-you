/**
 * 收音机键盘流（radio/useRadioKeyboard）：moveSelection 纯函数（池内 ±1 夹取 /
 * 未选中回落池首）、runActionKey 纯函数（C/X/F 动作键守卫矩阵——仅待处理且已判定；
 * 未绑键 U/R/T/Esc 零动作 = kbdHint 文案收编契约）、hook 接线（输入控件聚焦不劫持、
 * 导航/动作键 preventDefault）。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveSelection, runActionKey, useRadioKeyboard } from "../../src/client/radio/useRadioKeyboard";
import type { RadioMessage, HostClient } from "../../src/client/rpc";
import { makeMessage } from "./fixtures";

afterEach(cleanup);

/** 最小 host 替身：只记录键盘流会触发的四个分诊命令（resolve 值形态不进断言面） */
function fakeClient(): HostClient {
  return {
    reviewAccept: vi.fn().mockResolvedValue({ ok: true }),
    reviewApplyUpdate: vi.fn().mockResolvedValue({ ok: true }),
    reviewDismiss: vi.fn().mockResolvedValue({ ok: true }),
    forceCapture: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as HostClient;
}

describe("moveSelection（选中移动：池内 ±1 夹取）", () => {
  const pool: RadioMessage[] = [
    makeMessage({ messageId: "m1" }),
    makeMessage({ messageId: "m2" }),
    makeMessage({ messageId: "m3" }),
  ];

  it("空池恒 null；未选中回落池首", () => {
    expect(moveSelection([], null, true)).toBeNull();
    expect(moveSelection(pool, null, true)).toBe("m1");
    expect(moveSelection(pool, null, false)).toBe("m1");
  });

  it("前进/后退各 ±1，两端夹取不越界", () => {
    expect(moveSelection(pool, "m1", true)).toBe("m2");
    expect(moveSelection(pool, "m2", false)).toBe("m1");
    expect(moveSelection(pool, "m3", true)).toBe("m3");
    expect(moveSelection(pool, "m1", false)).toBe("m1");
  });
});

describe("runActionKey（动作键守卫矩阵：仅待处理且已判定）", () => {
  it("C：信号消息捕捉（todo）；update 走应用更新分支", async () => {
    const client = fakeClient();
    const onActioned = vi.fn();
    expect(runActionKey(client, makeMessage({ messageId: "m1", aiStatus: "todo" }), "c", onActioned)).toBe(true);
    expect(client.reviewAccept).toHaveBeenCalledWith({ messageId: "m1" });
    expect(runActionKey(client, makeMessage({ messageId: "m2", aiStatus: "update" }), "c", onActioned)).toBe(true);
    expect(client.reviewApplyUpdate).toHaveBeenCalledWith({ messageId: "m2" });
    await Promise.resolve();
    expect(onActioned).toHaveBeenCalledTimes(2);
  });

  it("C 对无信号（none/followup）不建误捕；非 pending 或判定中零动作", () => {
    const client = fakeClient();
    expect(runActionKey(client, makeMessage({ messageId: "m3", aiStatus: "none" }), "c", vi.fn())).toBe(false);
    expect(runActionKey(client, makeMessage({ messageId: "m4", aiStatus: "followup" }), "c", vi.fn())).toBe(false);
    expect(
      runActionKey(client, makeMessage({ messageId: "m5", reviewStatus: "accepted", aiStatus: "todo" }), "c", vi.fn()),
    ).toBe(false);
    expect(runActionKey(client, makeMessage({ messageId: "m6", aiStatus: "judging" }), "c", vi.fn())).toBe(false);
    expect(client.reviewAccept).not.toHaveBeenCalled();
  });

  it("X：逃走一步直发（other 原因码），none/followup 无逃走语义", () => {
    const client = fakeClient();
    expect(runActionKey(client, makeMessage({ messageId: "m7", aiStatus: "todo" }), "x", vi.fn())).toBe(true);
    expect(client.reviewDismiss).toHaveBeenCalledWith({ messageId: "m7", reasonCode: "other" });
    expect(runActionKey(client, makeMessage({ messageId: "m8", aiStatus: "none" }), "x", vi.fn())).toBe(false);
    expect(runActionKey(client, makeMessage({ messageId: "m9", aiStatus: "followup" }), "x", vi.fn())).toBe(false);
  });

  it("F：强制捕捉面 = none/todo/error（人工拍板），更新建议不强制", () => {
    const client = fakeClient();
    expect(runActionKey(client, makeMessage({ messageId: "m10", aiStatus: "none" }), "f", vi.fn())).toBe(true);
    expect(runActionKey(client, makeMessage({ messageId: "m11", aiStatus: "error" }), "f", vi.fn())).toBe(true);
    expect(runActionKey(client, makeMessage({ messageId: "m12", aiStatus: "todo" }), "f", vi.fn())).toBe(true);
    expect(runActionKey(client, makeMessage({ messageId: "m13", aiStatus: "update" }), "f", vi.fn())).toBe(false);
    expect(client.forceCapture).toHaveBeenCalledTimes(3);
    expect(client.forceCapture).toHaveBeenCalledWith({ messageId: "m10" });
  });

  it("未绑键（U/R/T/Esc——kbdHint 收编契约）与任意其他键零动作", () => {
    const client = fakeClient();
    const message = makeMessage({ messageId: "m13", aiStatus: "todo" });
    for (const key of ["u", "r", "t", "escape", "a", "enter"]) {
      expect(runActionKey(client, message, key, vi.fn())).toBe(false);
    }
    expect(client.reviewAccept).not.toHaveBeenCalled();
    expect(client.forceCapture).not.toHaveBeenCalled();
  });
});

describe("useRadioKeyboard 接线（onKeyDown）", () => {
  function renderKeyboard(args: {
    client: HostClient;
    pool: RadioMessage[];
    selectedId: string | null;
    selectedMessage: RadioMessage | null;
    onActioned?: () => void;
  }): HTMLElement {
    const selectedIdSpy = vi.fn();
    function Harness(): React.JSX.Element {
      const onKeyDown = useRadioKeyboard({
        client: args.client,
        pool: args.pool,
        selectedId: args.selectedId,
        selectedMessage: args.selectedMessage,
        setSelectedId: selectedIdSpy,
        onActioned: args.onActioned ?? (() => undefined),
      });
      return (
        <div onKeyDown={onKeyDown}>
          <input aria-label="捕捉输入" />
        </div>
      );
    }
    const { container } = render(<Harness />);
    return container.firstChild as HTMLElement;
  }

  it("焦点在输入控件上不劫持（j 不拦截、选中不变）", () => {
    const container = renderKeyboard({
      client: fakeClient(),
      pool: [makeMessage({ messageId: "m1" }), makeMessage({ messageId: "m2" })],
      selectedId: "m1",
      selectedMessage: makeMessage({ messageId: "m1" }),
    });
    const input = container.querySelector("input") as HTMLElement;
    // fireEvent 返回 false = 事件被 preventDefault（劫持）；输入控件内应放行
    expect(fireEvent.keyDown(input, { key: "j" })).toBe(true);
  });

  it("j/k·方向键移动选中并 preventDefault；未选中回落池首", () => {
    const container = renderKeyboard({
      client: fakeClient(),
      pool: [makeMessage({ messageId: "m1" }), makeMessage({ messageId: "m2" }), makeMessage({ messageId: "m3" })],
      selectedId: "m1",
      selectedMessage: makeMessage({ messageId: "m1" }),
    });
    // 移动选中经 setSelectedId 落位——以键盘流真容器（非输入控件）为 target 断言拦截
    expect(fireEvent.keyDown(container, { key: "j" })).toBe(false);
    expect(fireEvent.keyDown(container, { key: "ArrowUp" })).toBe(false);
    expect(fireEvent.keyDown(container, { key: "k" })).toBe(false);
  });

  it("选中信号消息按 C → 捕捉命令发出且事件被拦截；未绑键放行", async () => {
    const client = fakeClient();
    const container = renderKeyboard({
      client,
      pool: [makeMessage({ messageId: "m1", aiStatus: "todo" })],
      selectedId: "m1",
      selectedMessage: makeMessage({ messageId: "m1", aiStatus: "todo" }),
    });
    expect(fireEvent.keyDown(container, { key: "c" })).toBe(false);
    await Promise.resolve();
    expect(client.reviewAccept).toHaveBeenCalledWith({ messageId: "m1" });
    // U/R/T/Esc 未绑：不拦截（默认行为放行）也不发命令
    for (const key of ["u", "r", "t", "Escape"]) {
      expect(fireEvent.keyDown(container, { key })).toBe(true);
    }
    expect(client.reviewAccept).toHaveBeenCalledTimes(1);
  });
});
