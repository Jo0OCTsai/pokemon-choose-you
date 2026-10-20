/**
 * pk 通道开通执行器（ADR-0003 §3/§4）：本机 pk 落位（纯 dsh 场景 vendor →
 * ~/.choose-you/bin/pk）后 spawn `pk remote setup`，JSON 报告原样返回；
 * 失败形态也走报告（命令面呈现分步指引，不炸信封）。自 hostEntry 拆出（棘轮 max-lines）。
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureLocalPk } from "../remote/pkLocal";
import { dataDirFrom, logFilePathFrom } from "../storage/paths";

/** pk 开通报告（命令面 / 桌面 setup_deployment_pk 同构形态） */
export interface PkSetupReport {
  ok: boolean;
  version: string | null;
  steps: Array<{ name: string; status: string; detail: string }>;
}

const fail = (name: string, detail: string): PkSetupReport => ({
  ok: false,
  version: null,
  steps: [{ name, status: "fail", detail }],
});

/** 组装 remote setup 参数（key-dir 单源：<appHome>/data——双端收敛同一对密钥） */
function setupArgs(alias: string, tunnelPort: number): string[] {
  const keyDir = dataDirFrom();
  return [
    "remote",
    "setup",
    "--host",
    alias,
    "--tunnel-port",
    String(tunnelPort),
    ...(keyDir === undefined ? [] : ["--key-dir", keyDir]),
  ];
}

/**
 * pk 执行轨迹落盘（logshare.rs 同语义）：注入 `PK_LOG_FILE` 指向共享日志文件——
 * dsh 侧拉起的 pk 与桌面 app 拉起的一样进背包-诊断视图。目录先建（cli_log 的
 * OpenOptions 不会建父目录）；无法定位归一化根或目录建不了 → 不注入（pk 静默跳过，
 * 与桌面「目录缺失返回 None」同口径）。
 */
function pkLogEnv(): NodeJS.ProcessEnv | undefined {
  const file = logFilePathFrom();
  if (file === undefined) {
    return undefined;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    return undefined;
  }
  return { ...process.env, PK_LOG_FILE: file };
}

/** spawn pk remote setup 并解析 JSON 报告（超时 3 分钟；stdout 即报告） */
function runPkSetup(pk: string, alias: string, tunnelPort: number): Promise<PkSetupReport> {
  return new Promise((resolve) => {
    execFile(pk, setupArgs(alias, tunnelPort), { timeout: 180_000, env: pkLogEnv() }, (error, stdout) => {
      if (error !== null && stdout.trim() === "") {
        resolve(fail("执行 pk remote setup", String(error).slice(0, 300)));
        return;
      }
      try {
        const report = JSON.parse(stdout) as Partial<PkSetupReport>;
        resolve({
          ok: report.ok === true,
          version: report.version ?? null,
          steps: Array.isArray(report.steps) ? report.steps : [],
        });
      } catch {
        resolve(fail("解析报告", stdout.slice(0, 300)));
      }
    });
  });
}

/** createPlugin 的 pkSetup 依赖（hostEntry 装配注入） */
export function pkSetupOf(): (args: { alias: string; tunnelPort: number }) => Promise<PkSetupReport> {
  return async ({ alias, tunnelPort }) => {
    const pk = ensureLocalPk();
    if (pk === undefined) {
      return fail("定位本机 pk", "插件包 vendor/pk-<triple> 缺件且 ~/.choose-you/bin/pk 不存在——重装插件或手动放置");
    }
    return runPkSetup(pk, alias, tunnelPort);
  };
}
