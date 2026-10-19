/**
 * pk 通道开通执行器（dsh/pkSetup）：spawn `pk remote setup` 的报告解析三分支
 * （JSON 成功 / 非 JSON 输出 / 进程错误无 stdout）与落位缺件降级（mock pkLocal）。
 */
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/host/remote/pkLocal", () => ({
  ensureLocalPk: vi.fn<() => string | undefined>(),
}));
vi.mock("../src/host/storage/paths", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/host/storage/paths")>();
  return { ...real, dataDirFrom: vi.fn(() => undefined) };
});

import { dataDirFrom } from "../src/host/storage/paths";
import { ensureLocalPk } from "../src/host/remote/pkLocal";
import { pkSetupOf } from "../src/host/dsh/pkSetup";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-pksetup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** 假 pk：把参数原样回显后输出 stdout（模拟 pk remote setup 的 JSON 报告） */
function fakePk(stdout: string): string {
  const p = join(dir, "pk-ok");
  writeFileSync(p, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout).replace(/'/g, "'\\''")}\nexit 0\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("pkSetupOf", () => {
  it("本机 pk 缺件 → 定位失败报告（降级不炸信封）", async () => {
    vi.mocked(ensureLocalPk).mockReturnValue(undefined);
    const report = await pkSetupOf()({ alias: "gpu-1", tunnelPort: 10022 });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.name).toBe("定位本机 pk");
  });

  it("JSON 报告解析成功（ok/version/steps 透传；key-dir 有值分支）", async () => {
    vi.mocked(dataDirFrom).mockReturnValue(join(dir, "data"));
    vi.mocked(ensureLocalPk).mockReturnValue(fakePk('{"ok":true,"version":"1.2.3","steps":[]}'));
    const report = await pkSetupOf()({ alias: "gpu-1", tunnelPort: 10022 });
    expect(report).toMatchObject({ ok: true, version: "1.2.3", steps: [] });
  });

  it("非 JSON 输出 → 解析失败报告（stdout 片段进详情）", async () => {
    vi.mocked(ensureLocalPk).mockReturnValue(fakePk("not-json"));
    const report = await pkSetupOf()({ alias: "gpu-1", tunnelPort: 10022 });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.detail).toContain("not-json");
  });

  it("进程错误且无 stdout → 执行失败报告", async () => {
    // 指向目录（不可执行）→ execFile error 且 stdout 空
    vi.mocked(ensureLocalPk).mockReturnValue(dir);
    const report = await pkSetupOf()({ alias: "gpu-1", tunnelPort: 10022 });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.name).toBe("执行 pk remote setup");
  });
});
