/**
 * 诊断段扩展与 HelperBanner（U30/FR-A2/FR-RD7/FR-X9-4）：helper 六能力矩阵 × 两态 +
 * 缺失指引 + 运行时版本；快捷键注册行（失败才显示）；SSH 家族探测行；面板顶部
 * HelperBanner（helperCaps null = helper 缺席；「查看诊断」锚到背包·诊断分区；
 * 与 SchemaBanner 同族不叠抢——schema 优先在上）。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginDetailPage } from "../../src/client/app/PluginDetailPage";
import { mockHost } from "../../src/client/rpc";
import { makeData } from "./fixtures";

afterEach(cleanup);

async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("HelperBanner（面板顶部 · U30）", () => {
  it("helper 在位（能力位全 true）→ 无横幅", async () => {
    render(<PluginDetailPage client={mockHost()} data={makeData()} onChanged={() => undefined} />);
    await flush();
    expect(screen.queryByTestId("helper-banner")).toBeNull();
  });

  it("helper 缺席（helperCaps null）→ 静态横幅（role=status）+「查看诊断」锚到诊断分区", async () => {
    const host = mockHost({ helperCaps: null });
    render(<PluginDetailPage client={host} data={makeData()} onChanged={() => undefined} />);
    await flush();
    const banner = screen.getByTestId("helper-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain("系统能力面降级");
    expect(banner.textContent).toContain("核心待办不受影响");
    fireEvent.click(screen.getByText("查看诊断"));
    await flush();
    // 锚到背包·诊断分区（分区页呈现诊断内容）
    expect(screen.getByTestId("helper-caps")).toBeTruthy();
    expect(screen.getByText("托盘")).toBeTruthy();
  });

  it("与 SchemaBanner 同族不叠抢：只读态两者同时呈现、schema 在上", async () => {
    const data = makeData({ dbStatus: { userVersion: 2, pluginWindow: { min: 1, max: 1 }, mode: "ro" } });
    render(<PluginDetailPage client={mockHost({ helperCaps: null })} data={data} onChanged={() => undefined} />);
    await flush();
    expect(screen.getByTestId("schema-banner")).toBeTruthy();
    expect(screen.getByTestId("helper-banner")).toBeTruthy();
    const page = screen.getByTestId("schema-banner").parentElement;
    expect(page?.querySelector(":scope > *")).toBe(screen.getByTestId("schema-banner"));
  });
});

describe("诊断段三件（背包·诊断分区 · U30）", () => {
  async function bootDiag(host = mockHost()) {
    render(<PluginDetailPage client={host} data={makeData()} onChanged={() => undefined} />);
    await flush();
    fireEvent.click(screen.getByText("背包"));
    await flush();
    fireEvent.click(screen.getByText(/诊断/));
    await flush();
    return host;
  }

  it("helper 能力矩阵：六能力 × 可用两态（全 true 时无缺失指引）+ 运行时版本", async () => {
    const host = mockHost({ helperVersion: "1.2.3-mock" });
    await bootDiag(host);
    const matrix = screen.getByTestId("helper-caps");
    for (const name of ["托盘", "全局快捷键", "通知", "文件对话框", "语音", "输入计数"]) {
      expect(within(matrix).getAllByText(name).length).toBeGreaterThanOrEqual(1);
      expect(within(matrix).getAllByText("可用").length).toBeGreaterThanOrEqual(1);
    }
    expect(within(matrix).queryAllByText("降级")).toHaveLength(0);
    expect(within(matrix).getByText(/helper 运行时：1\.2\.3-mock/)).toBeTruthy();
  });

  it("能力降级行附缺失指引（部分能力位缺失）", async () => {
    await bootDiag(
      mockHost({
        helperCaps: { "sys-tray": true, "sys-notify": false, "input-count": false } as Record<string, boolean>,
      }),
    );
    const matrix = screen.getByTestId("helper-caps");
    expect(within(matrix).getAllByText("降级").length).toBeGreaterThanOrEqual(2);
    expect(within(matrix).getAllByText(/依赖 helper sidecar/).length).toBeGreaterThanOrEqual(2);
  });

  it("快捷键注册行：成功不显示 / 失败才显示（⌘⇧K 降级通道提示）", async () => {
    await bootDiag(mockHost());
    expect(screen.queryByTestId("shortcut-line")).toBeNull();
    cleanup();
    await bootDiag(mockHost({ shortcutRegistered: false }));
    expect(screen.getByTestId("shortcut-line").textContent).toContain("全局快捷键注册失败");
    expect(screen.getByTestId("shortcut-line").textContent).toContain("⌘⇧K");
  });

  it("SSH 家族行：就绪 / 缺失 + 装载指引命令；未知（null）不显", async () => {
    await bootDiag(mockHost());
    expect(screen.getByTestId("ssh-family-line").textContent).toContain("就绪");
    cleanup();
    await bootDiag(mockHost({ sshFamily: { ok: false, detail: "dsh plugin add @deepseek-ai/dsh-ssh" } }));
    const line = screen.getByTestId("ssh-family-line");
    expect(line.textContent).toContain("未装载");
    expect(line.textContent).toContain("dsh plugin add @deepseek-ai/dsh-ssh");
  });

  it("诊断日志屏 = LcdScreen 单源组件（与向导输出屏同件两落位）", async () => {
    await bootDiag(
      mockHost({ logEntries: [{ time: "2026-10-17 09:00:00", level: "info", target: "poll", message: "ok" }] }),
    );
    expect(screen.getByTestId("log-viewer")).toBeTruthy();
    fireEvent.click(screen.getByText("刷新"));
    await flush();
    expect(screen.getByTestId("log-screen")).toBeTruthy();
  });
});
