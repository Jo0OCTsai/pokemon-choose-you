/**
 * 通用分区备份/导出卡组件测试：立即备份按钮（mock 调用 + 成功提示含文件名 + 列表
 * 渲染/空态）、三种导出按钮（kind 透传 + 写入路径提示）、只读模式（dbStatus ro）按钮禁用。
 * mock 语义见 mockBackup.ts；真实落盘行为由 __tests__/backup-export.spec.ts 真库覆盖。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { GeneralSection } from "../../src/client/settings/sections/GeneralSection";

afterEach(cleanup);

/** 直渲通用分区（备份/导出卡不依赖保存制草稿——空 draft 即可） */
function renderSection(host: MockHost = mockHost()): MockHost {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <GeneralSection draft={{}} saved={{}} onField={() => undefined} onSavedKeys={() => undefined} />
      </I18nProvider>
    </ClientProvider>,
  );
  return host;
}

describe("备份卡（立即备份 + 列表）", () => {
  it("点「立即备份」→ backupRun 调用 + 成功提示含新文件名 + 列表渲染文件与大小", async () => {
    const host = renderSection();
    fireEvent.click(screen.getByTestId("backup-now"));
    await waitFor(() =>
      expect(screen.getByTestId("backup-msg").textContent).toContain("pokemon-choose-you-20261011-080000.db"),
    );
    expect(host.calls).toContainEqual({ command: "backupRun", params: {} });
    expect(screen.getByTestId("backup-list").textContent).toContain("pokemon-choose-you-20261011-080000.db");
    expect(screen.getByTestId("backup-list").textContent).toContain("4 KB");
  });

  it("初始空列表 → 空态文案；已有备份 → 挂载即列出（时间·大小）", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText("还没有备份，点「立即备份」创建第一份")).toBeTruthy());

    cleanup();
    renderSection(
      mockHost({
        backups: [
          { file: "pokemon-choose-you-20260913-080000.db", size: 2048, createdAt: "2026-09-13T08:00:00+08:00" },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("backup-list").textContent).toContain("pokemon-choose-you-20260913-080000.db"),
    );
    expect(screen.getByTestId("backup-list").textContent).toContain("2 KB");
  });
});

describe("数据导出卡（三种导出按钮）", () => {
  it("三个按钮分别以 json/csv/report 调 exportRun，成功提示写入路径", async () => {
    const host = renderSection();

    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(screen.getByTestId("export-msg").textContent).toContain("pokemon-choose-you-full-20261011-080000.json"),
    );
    expect(host.calls).toContainEqual({ command: "exportRun", params: { kind: "json" } });

    fireEvent.click(screen.getByTestId("export-csv"));
    await waitFor(() =>
      expect(screen.getByTestId("export-msg").textContent).toContain("pokemon-choose-you-tasks-20261011-080000.csv"),
    );
    expect(host.calls).toContainEqual({ command: "exportRun", params: { kind: "csv" } });

    fireEvent.click(screen.getByTestId("export-report"));
    await waitFor(() =>
      expect(screen.getByTestId("export-msg").textContent).toContain("pokemon-choose-you-daily-2026-10-11.md"),
    );
    expect(host.calls).toContainEqual({ command: "exportRun", params: { kind: "report" } });
  });

  it("导出卡说明挂卡标题 data-tip（export.hint）", () => {
    renderSection();
    expect(screen.getByText("数据导出 / 导入").getAttribute("data-tip")).toContain("导出产物在");
  });
});

describe("只读模式（dbStatus ro）", () => {
  it("备份与导出按钮统一禁用且不发起调用", async () => {
    const host = renderSection(
      mockHost({ dbStatus: { userVersion: 9, pluginWindow: { min: 1, max: 2 }, mode: "readonly" } }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("backup-now").hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId("export-json").hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId("export-csv").hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId("export-report").hasAttribute("disabled")).toBe(true);
    });
    fireEvent.click(screen.getByTestId("backup-now"));
    await waitFor(() => expect(host.calls.map((c) => c.command)).toContain("dbStatus"));
    expect(host.calls.map((c) => c.command)).not.toContain("backupRun");
    expect(host.calls.map((c) => c.command)).not.toContain("exportRun");
  });
});
