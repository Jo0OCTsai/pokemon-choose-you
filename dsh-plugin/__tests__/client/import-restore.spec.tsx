/**
 * 导入/恢复确认流（U25/FR-A5/D25）：导出卡两新按钮；ImportConfirmModal 全态序
 * （选文件 → 校验中 → 校验失败原因列表 + 换一个文件 → 二次确认[整体替换 + 已自动备份
 * 实文件名] → 执行中 → 成功/备份失败中止）；BackupCard 恢复升级（行内恢复/从文件恢复 →
 * RestoreConfirmModal：确认 → 成功补跑迁移说明 / 超窗拒绝态确认键禁用 / 失败保留原因）；
 * 导出目录失败 toast 文案；只读禁用清单（M7——导入/从文件恢复禁用、托管恢复放行、导出不受限）。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHost } from "../../src/client/rpc";
import { SettingsSegment } from "../../src/client/settings/SettingsSegment";
import { makeData } from "./fixtures";

afterEach(cleanup);

async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const BACKUPS = [{ file: "pokemon-choose-you-20261011-080000.db", size: 4096, createdAt: "2026-10-11T08:00:00+08:00" }];

/** 通用分区整页（保存制回调替身） */
function renderGeneral(host: MockHost) {
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <SettingsSegment
          data={makeData()}
          onChanged={vi.fn()}
          leaveRequest={null}
          onLeaveResolved={vi.fn()}
          onUnsavedChange={vi.fn()}
          initialSection="general"
        />
      </I18nProvider>
    </ClientProvider>,
  );
}

async function bootGeneral(host: MockHost): Promise<MockHost> {
  renderGeneral(host);
  await flush();
  return host;
}

/** 文件选择（input[type=file] 承接——happy-dom 的 files 为只读 getter，经 defineProperty 注入；
 *  File 无 path，回落文件名） */
function pickFile(label: string, name: string): void {
  const input = screen.getByTestId(label) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["{}"], name, { type: name.endsWith(".json") ? "application/json" : "application/octet-stream" })],
    configurable: true,
  });
  fireEvent.change(input);
}

describe("导出卡两新按钮（U25）", () => {
  it("「导入 JSON」「打开导出目录」齐备；导出目录成功不弹消息", async () => {
    const host = await bootGeneral(mockHost({ backups: BACKUPS }));
    expect(screen.getByTestId("import-json")).toBeTruthy();
    expect(screen.getByTestId("export-dir-open")).toBeTruthy();
    fireEvent.click(screen.getByTestId("export-dir-open"));
    await flush();
    expect(host.calls.some((c) => c.command === "exportDirOpen")).toBe(true);
    expect(screen.queryByTestId("export-msg")?.textContent ?? "").not.toContain("打开导出目录失败");
  });

  it("打开导出目录失败 → 原因 + 可手动前往路径（hint 承载）", async () => {
    await bootGeneral(mockHost({ backups: BACKUPS, exportDir: { path: "/mock/exports", error: "helper 未运行" } }));
    fireEvent.click(screen.getByTestId("export-dir-open"));
    await flush();
    const msg = screen.getByTestId("export-msg").textContent ?? "";
    expect(msg).toContain("打开导出目录失败：helper 未运行");
    expect(msg).toContain("/mock/exports");
  });
});

describe("ImportConfirmModal 全态序", () => {
  it("合法文件：校验中 → 二次确认（整体替换 + 已自动备份实文件名）→ 成功 N 项", async () => {
    const host = await bootGeneral(
      mockHost({
        backups: BACKUPS,
        importFiles: [{ path: "pokemon-choose-you-full.json" }],
        importResult: { backupId: "pokemon-choose-you-20261017-090000.db", applied: 12 },
      }),
    );
    fireEvent.click(screen.getByTestId("import-json"));
    pickFile("import-file-input", "pokemon-choose-you-full.json");
    await flush();
    const modal = screen.getByTestId("import-modal");
    expect(within(modal).getByText(/导入将整体替换当前待办数据/)).toBeTruthy();
    expect(within(modal).getByText(/已自动备份：pokemon-choose-you-20261017-090000\.db/)).toBeTruthy();
    expect(within(modal).getByText(/秘钥与提示词覆盖行保留/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认导入"));
    await flush();
    expect(screen.getByTestId("import-done").textContent).toContain("已导入 12 项");
    expect(
      host.calls.some(
        (c) => c.command === "importRun" && (c.params as { path: string }).path === "pokemon-choose-you-full.json",
      ),
    ).toBe(true);
  });

  it("校验失败：原因列表 + 0 行变更承诺 + [换一个文件]（确认键不可达）", async () => {
    await bootGeneral(
      mockHost({
        backups: BACKUPS,
        importFiles: [{ path: "bad.json", reasons: ["app 字段不符", "结构坏"] }],
      }),
    );
    fireEvent.click(screen.getByTestId("import-json"));
    pickFile("import-file-input", "bad.json");
    await flush();
    const modal = screen.getByTestId("import-modal");
    expect(within(modal).getByText(/app 字段不符；结构坏/)).toBeTruthy();
    expect(within(modal).getByText(/库内容未改动（0 行变更）/)).toBeTruthy();
    expect(screen.getByText("换一个文件")).toBeTruthy();
    expect(screen.queryByText("确认导入")).toBeNull();
  });

  it("备份失败中止态：BACKUP_FAILED → 中止文案、库内容未改动", async () => {
    await bootGeneral(
      mockHost({
        backups: BACKUPS,
        importFiles: [{ path: "ok.json", backupFail: true }],
      }),
    );
    fireEvent.click(screen.getByTestId("import-json"));
    pickFile("import-file-input", "ok.json");
    await flush();
    fireEvent.click(screen.getByText("确认导入"));
    await flush();
    expect(screen.getByTestId("import-backup-failed").textContent).toContain("已中止导入");
  });
});

describe("RestoreConfirmModal（备份卡恢复升级）", () => {
  it("行内恢复：二次确认 → 成功（补跑迁移与补种说明）；restoreRun 带 backupId", async () => {
    const host = await bootGeneral(mockHost({ backups: BACKUPS }));
    fireEvent.click(screen.getByTestId("backup-restore"));
    const modal = screen.getByTestId("restore-modal");
    expect(modal.textContent).toContain("恢复「pokemon-choose-you-20261011-080000.db」将整体替换当前库");
    expect(modal.textContent).toContain("恢复前已自动备份当前数据");
    fireEvent.click(screen.getByText("确认恢复"));
    await flush();
    expect(screen.getByTestId("restore-done").textContent).toContain("已自动补跑迁移与默认分类补种");
    expect(
      host.calls.some(
        (c) =>
          c.command === "restoreRun" &&
          (c.params as { source: { backupId?: string } }).source.backupId === BACKUPS[0].file,
      ),
    ).toBe(true);
  });

  it("版本超窗拒绝态（DB_SCHEMA_TOO_NEW）：确认键禁用 + 升级指引 + 当前库未改动", async () => {
    await bootGeneral(
      mockHost({
        backups: BACKUPS,
        restoreOutcome: { ok: false, code: "DB_SCHEMA_TOO_NEW", message: "备份 user_version=3 超出窗口上限 2" },
      }),
    );
    fireEvent.click(screen.getByTestId("backup-restore"));
    fireEvent.click(screen.getByText("确认恢复"));
    await flush();
    expect(screen.getByTestId("restore-rejected").textContent).toContain("需升级插件后恢复");
    expect(screen.getByTestId("restore-rejected").textContent).toContain("当前库未改动");
    const confirm = screen.getAllByText("确认恢复").find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("恢复失败保留原因（当前库保持恢复前状态）", async () => {
    await bootGeneral(
      mockHost({
        backups: BACKUPS,
        restoreOutcome: { ok: false, code: "BACKUP_FAILED", message: "磁盘空间不足" },
      }),
    );
    fireEvent.click(screen.getByTestId("backup-restore"));
    fireEvent.click(screen.getByText("确认恢复"));
    await flush();
    expect(screen.getByTestId("restore-failed").textContent).toContain("磁盘空间不足");
    expect(screen.getByTestId("restore-failed").textContent).toContain("当前库保持恢复前状态");
  });

  it("「从文件恢复…」：选 .db 文件 → 确认弹层（restoreRun 走 path 白名单）", async () => {
    const host = await bootGeneral(mockHost({ backups: BACKUPS }));
    fireEvent.click(screen.getByTestId("restore-from-file"));
    pickFile("restore-file-input", "pokemon-choose-you-20261001-000000.db");
    await flush();
    const modal = screen.getByTestId("restore-modal");
    expect(within(modal).getByText(/pokemon-choose-you-20261001-000000\.db/)).toBeTruthy();
    fireEvent.click(screen.getByText("确认恢复"));
    await flush();
    expect(
      host.calls.some(
        (c) =>
          c.command === "restoreRun" &&
          (c.params as { source: { path?: string } }).source.path === "pokemon-choose-you-20261001-000000.db",
      ),
    ).toBe(true);
  });
});

describe("只读禁用清单（M7）", () => {
  const ro = { userVersion: 2, pluginWindow: { min: 1, max: 1 }, mode: "readonly" as const };

  it("「导入 JSON」「从文件恢复…」禁用；托管备份「恢复」放行（解除只读的既有通道）；导出不受限", async () => {
    await bootGeneral(mockHost({ backups: BACKUPS, dbStatus: ro }));
    expect((screen.getByTestId("import-json") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("restore-from-file") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("backup-restore") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("export-dir-open") as HTMLButtonElement).disabled).toBe(false);
    // 放行的恢复通道照常可走确认流
    fireEvent.click(screen.getByTestId("backup-restore"));
    expect(screen.getByTestId("restore-modal")).toBeTruthy();
  });
});
