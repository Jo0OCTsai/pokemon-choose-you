/**
 * agent 工具面测试（pk 技能行 + 连接测试按钮）：编辑态草稿值优先（command/dir 覆盖）、
 * 状态文案三档、安装成功文案、测试结果回显。
 */
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeData } from "./fixtures";
import { getPage, gotoSection, renderSettings } from "./settingsHarness";

afterEach(cleanup);
vi.useFakeTimers();

/** 刷穿安装→回查的串行 await 链（两层 runAllTimersAsync 深度） */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.runAllTimersAsync();
    await vi.runAllTimersAsync();
  });
}

describe("Agent 分区 · pk 技能行与连接测试", () => {
  it("检查/安装即调命令并带草稿覆盖；测试按钮回显探针结果", async () => {
    const data = makeData();
    data.agents = [
      {
        id: "ag-probe",
        name: "Claude",
        command: "claude",
        args: "",
        historyArgs: "",
        workdir: "",
        skillDir: null,
        timeoutSecs: 120,
        enabled: true,
      },
    ];
    const { host } = renderSettings(data);
    gotoSection("Agent");
    const page = getPage("agents");
    fireEvent.click(within(page).getByText("编辑"));
    const skillLine = within(page).getByTestId("agent-skill-line");
    // 初始未检查文案；点检查 → pkSkillCheck（带 command/dir 草稿覆盖）
    expect(skillLine.textContent).toContain("未检查");
    fireEvent.click(within(skillLine).getByText("检查"));
    await flush();
    expect(host.calls.find((c) => c.command === "pkSkillCheck")?.params).toMatchObject({
      command: "claude",
    });
    // 安装 → pkSkillInstall + 成功文案（mock 装到最新）
    fireEvent.click(within(skillLine).getByText("安装/同步"));
    await flush();
    expect(host.calls.find((c) => c.command === "pkSkillInstall")?.params).toMatchObject({
      command: "claude",
    });
    expect(page.textContent).toContain("已装");
    // 测试按钮 → agentTest + 探针成功文案回显
    fireEvent.click(within(page).getByText("测试"));
    await flush();
    expect(host.calls.find((c) => c.command === "agentTest")?.params).toMatchObject({
      agentId: "ag-probe",
    });
    expect(within(page).getByTestId("agent-test-msg").textContent).toContain("已连通");
  });
});
