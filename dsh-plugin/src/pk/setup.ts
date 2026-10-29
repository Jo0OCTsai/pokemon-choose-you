/**
 * remote setup 九步幂等开通（对齐 commands/remote_pk.rs 的 run_setup，ADR-0006 双实现）：
 * 定位 pk → 本机 sshd → 专用密钥 → 公钥装配（authorized-keys.ts 四形态收口）→ 推私钥 →
 * 预信任指纹 → 安装 shim → 远程 PATH → 端到端验证 + ControlPersist 收尾。任一步失败即停，
 * 报告到失败步为止（SetupReport 与 Rust 实现同构：camelCase ok/steps[]/version）。
 * 步骤函数化（拆件控复杂度）：每步返回 false/null 表示失败（fail 步自行入 steps）。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { keyscanLocal, sshRun, type SshCtx } from "./ssh";
import { assembleAuthorizedKeys } from "./authorized-keys";
import { shimScript, toKnownHostsLines, verifyRemoteLine } from "./shim";

export const DEFAULT_TUNNEL_PORT = 10022;

export interface SetupStep {
  name: string;
  /** ok / skip（幂等复用）/ fail */
  status: string;
  detail: string;
}

export interface SetupReport {
  ok: boolean;
  steps: SetupStep[];
  /** 端到端验证拿回的远程 pk 版本 */
  version: string | null;
}

/** 一键配置的执行上下文（路径与目录可注入，供测试复用；RemotePkSetup 同构） */
export interface SetupCtx extends SshCtx {
  /** ssh-keygen 程序名/路径（生成专用密钥；可注入供测试） */
  sshKeygenProgram: string;
  /** 反向隧道端口（远程侧监听） */
  tunnelPort: number;
  /** 本机用户名（shim 回连 user@127.0.0.1 认证用） */
  localUser: string;
  /** 本机 pk 的绝对路径（内嵌进 shim） */
  pkPath: string;
  /** 专用密钥的存放目录 */
  keyDir: string;
  /** 本机用户主目录（authorized_keys 落点，可注入供测试） */
  localHome: string;
}

const isWindows = process.platform === "win32";

/** 专用密钥文件对（key_dir 下的固定名） */
function keyFiles(keyDir: string): [string, string] {
  return [join(keyDir, "remote_pk_shim_ed25519"), `${join(keyDir, "remote_pk_shim_ed25519")}.pub`];
}

/** 执行一键配置序列（编排层；步骤实现见下方 step 函数） */
export function runSetup(ctx: SetupCtx): SetupReport {
  const steps: SetupStep[] = [];
  if (!stepLocatePk(ctx, steps)) return reportOf(steps, null);
  const hostKeys = stepKeyScan(ctx, steps);
  if (hostKeys === null) return reportOf(steps, null);
  const key = stepKey(ctx, steps);
  if (key === null) return reportOf(steps, null);
  if (!assembleAuthorizedKeys(ctx, key.pubLine, steps)) return reportOf(steps, null);
  if (!stepPushPrivKey(ctx, steps, key.privText)) return reportOf(steps, null);
  if (!stepKnownHosts(ctx, steps, hostKeys)) return reportOf(steps, null);
  if (!stepInstallShim(ctx, steps)) return reportOf(steps, null);
  if (!stepRemotePath(ctx, steps)) return reportOf(steps, null);
  return stepVerify(ctx, steps);
}

function reportOf(steps: SetupStep[], version: string | null): SetupReport {
  return { ok: false, steps, version };
}

/** 1. 本机 pk 定位（存在、非空占位、可执行；unix 无执行位自动补） */
function stepLocatePk(ctx: SetupCtx, steps: SetupStep[]): boolean {
  const fail = (detail: string): boolean => {
    steps.push({ name: "定位 pk", status: "fail", detail });
    return false;
  };
  if (!existsSync(ctx.pkPath)) {
    return fail(`未找到本机 pk：${ctx.pkPath}（仅安装版应用支持一键配置）`);
  }
  let size = 0;
  try {
    size = statSync(ctx.pkPath).size;
  } catch (e) {
    return fail(`读取 ${ctx.pkPath} 失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (size === 0) {
    return fail(`${ctx.pkPath} 是空占位文件。安装版应用无此问题；开发态请确认分发产物完整后重试`);
  }
  let detail = "";
  if (!isWindows && (statSync(ctx.pkPath).mode & 0o111) === 0) {
    // 占位拷贝常不带执行位；顺手补上（同用户可写，一般都能成功）
    try {
      chmodSync(ctx.pkPath, (statSync(ctx.pkPath).mode & 0o777) | 0o755);
      detail = "（已自动补执行权限）";
    } catch {
      return fail(`${ctx.pkPath} 无执行权限且自动补权失败，请手动 chmod +x`);
    }
  }
  steps.push({ name: "定位 pk", status: "ok", detail: `${ctx.pkPath}${detail}` });
  return true;
}

/** 2. 本机 sshd 可达（隧道终点；只扫端口不认证） */
function stepKeyScan(ctx: SetupCtx, steps: SetupStep[]): string | null {
  const hostKeys = keyscanLocal(ctx.keyscanProgram, 10_000);
  if (hostKeys === null) {
    steps.push({
      name: "本机 sshd",
      status: "fail",
      detail:
        "本机 22 端口无应答——请先开启 sshd（隧道终点，只需本机回环可达，防火墙无需放行）：macOS 系统设置 → 通用 → 共享 → 远程登录；Windows 安装并启动「OpenSSH SSH 服务器」；Linux `sudo systemctl enable --now sshd`",
    });
    return null;
  }
  steps.push({ name: "本机 sshd", status: "ok", detail: "22 端口可达（仅回环即可）" });
  return hostKeys;
}

/** 3. 专用密钥：已有则复用，缺则生成（幂等） */
function stepKey(ctx: SetupCtx, steps: SetupStep[]): { pubLine: string; privText: string } | null {
  const [keyPriv, keyPub] = keyFiles(ctx.keyDir);
  if (existsSync(keyPriv) && existsSync(keyPub)) {
    steps.push({ name: "专用密钥", status: "skip", detail: `复用已有密钥 ${keyPriv}` });
  } else if (generateKey(ctx, keyPriv, steps)) {
    steps.push({ name: "专用密钥", status: "ok", detail: `已生成 ${keyPriv}` });
  } else {
    return null;
  }
  try {
    const pubLine = readFileSync(keyPub, "utf8").trim();
    const privText = readFileSync(keyPriv, "utf8");
    if (pubLine !== "") {
      return { pubLine, privText };
    }
  } catch {
    // 落到不可读报错
  }
  steps.push({ name: "专用密钥", status: "fail", detail: "密钥文件不可读" });
  return null;
}

function generateKey(ctx: SetupCtx, keyPriv: string, steps: SetupStep[]): boolean {
  try {
    mkdirSync(ctx.keyDir, { recursive: true });
  } catch {
    // 目录已存在或不可建——生成步骤会给出具体失败
  }
  try {
    execFileSync(
      ctx.sshKeygenProgram,
      ["-t", "ed25519", "-N", "", "-C", "pokemon-knock remote pk shim", "-f", keyPriv],
      { encoding: "utf8", timeout: 30_000 },
    );
    return true;
  } catch (e) {
    steps.push({
      name: "专用密钥",
      status: "fail",
      detail: `ssh-keygen 生成失败（需 OpenSSH 客户端）：${e instanceof Error ? e.message : String(e)}`,
    });
    return false;
  }
}

/** 5. 私钥推到远程（载荷走 stdin 不经远端 shell 重解析） */
function stepPushPrivKey(ctx: SetupCtx, steps: SetupStep[], privText: string): boolean {
  const [ok, err] = sshRun(
    ctx,
    [],
    'umask 077 && mkdir -p "$HOME/.ssh" && cat > "$HOME/.ssh/pk_shim" && chmod 600 "$HOME/.ssh/pk_shim"',
    privText,
  );
  if (!ok) {
    steps.push({
      name: "推送私钥",
      status: "fail",
      detail: `经 ssh 写远程 ~/.ssh/pk_shim 失败：${err}（确认 agent 的 SSH 配置可免密登录）`,
    });
    return false;
  }
  steps.push({ name: "推送私钥", status: "ok", detail: "远程 ~/.ssh/pk_shim（600）" });
  return true;
}

/** 6. 预信任主机指纹（shim 走 BatchMode，首次连接交互确认必失败，必须预先信任） */
function stepKnownHosts(ctx: SetupCtx, steps: SetupStep[], hostKeys: string): boolean {
  const [ok, err] = sshRun(
    ctx,
    [],
    `mkdir -p "$HOME/.ssh" && touch "$HOME/.ssh/known_hosts" && chmod 600 "$HOME/.ssh/known_hosts"; ` +
      `ssh-keygen -R "[127.0.0.1]:${ctx.tunnelPort}" -f "$HOME/.ssh/known_hosts" 2>/dev/null; ` +
      `cat >> "$HOME/.ssh/known_hosts"`,
    toKnownHostsLines(hostKeys, ctx.tunnelPort),
  );
  if (!ok) {
    steps.push({ name: "预信任主机指纹", status: "fail", detail: `写远程 known_hosts 失败：${err}` });
    return false;
  }
  steps.push({
    name: "预信任主机指纹",
    status: "ok",
    detail: `[127.0.0.1]:${ctx.tunnelPort}（隧道终点的本机 sshd）`,
  });
  return true;
}

/** 7. 安装 shim 到远程 ~/.local/bin（内嵌本机 pk 绝对路径与隧道端口） */
function stepInstallShim(ctx: SetupCtx, steps: SetupStep[]): boolean {
  const [ok, err] = sshRun(
    ctx,
    [],
    'umask 022 && mkdir -p "$HOME/.local/bin" && cat > "$HOME/.local/bin/pk" && chmod 755 "$HOME/.local/bin/pk"',
    shimScript(ctx.pkPath, ctx.tunnelPort, ctx.localUser),
  );
  if (!ok) {
    steps.push({ name: "安装 shim", status: "fail", detail: `写远程 ~/.local/bin/pk 失败：${err}` });
    return false;
  }
  steps.push({
    name: "安装 shim",
    status: "ok",
    detail: "远程 ~/.local/bin/pk（若同一远程配多个 agent，请保持相同隧道端口）",
  });
  return true;
}

/** 8. 远程登录 shell 的 PATH 能找到 pk；不能则补 ~/.profile 等再验 */
function stepRemotePath(ctx: SetupCtx, steps: SetupStep[]): boolean {
  const [found] = sshRun(ctx, [], "exec \"$SHELL\" -lc 'command -v pk'", null);
  if (found) {
    // 口径注明：本步验证登录 shell；agent 实际跑在非登录 shell，其 PATH 由派发
    // 脚本前插 ~/.local/bin 兜底保证——两径独立
    steps.push({
      name: "远程 PATH",
      status: "ok",
      detail: "登录 shell 已能找到 pk（agent 非登录执行链另由派发兜底段保证 ~/.local/bin 可达）",
    });
    return true;
  }
  const ensure =
    "for f in .profile .zprofile .bash_profile; do grep -qs '.local/bin' \"$HOME/$f\" 2>/dev/null || " +
    'printf \'\\nexport PATH="$HOME/.local/bin:$PATH"\\n\' >> "$HOME/$f"; done; ' +
    "exec \"$SHELL\" -lc 'command -v pk'";
  const [ok2, out2] = sshRun(ctx, [], ensure, null);
  if (ok2 && out2.trim() !== "") {
    steps.push({ name: "远程 PATH", status: "ok", detail: `已补 PATH（${out2.trim()}）` });
    return true;
  }
  steps.push({
    name: "远程 PATH",
    status: "fail",
    detail: "已尝试补 PATH 但登录 shell 仍找不到 pk，请在远程手动确认 ~/.local/bin 可用",
  });
  return false;
}

/** 9. 端到端验证：真实开一条带 -R 的 ssh 连接执行 pk --version——shim 真回连一次本机 */
function stepVerify(ctx: SetupCtx, steps: SetupStep[]): SetupReport {
  const [ok, out] = sshRun(ctx, ["-R", `127.0.0.1:${ctx.tunnelPort}:127.0.0.1:22`], verifyRemoteLine(), null);
  const version = out.trim();
  if (ok && version !== "") {
    steps.push({ name: "端到端验证", status: "ok", detail: `远程经隧道回本机执行成功（pk ${version}）` });
    return { ok: true, steps, version };
  }
  steps.push({
    name: "端到端验证",
    status: "fail",
    detail: `远程 pk --version 未返回版本：${out}（${verifyHint(out)}）`,
  });
  return reportOf(steps, null);
}

/** 端到端失败的修复建议（verify_remote_line 的 hint 分支同构） */
function verifyHint(out: string): string {
  if (out.includes("refused")) {
    return "隧道端口未通（本步自动建立临时隧道，失败多为 sshd 仅监听 IPv6 或被安全软件拦截）";
  }
  if (out.toLowerCase().includes("permission denied") && !out.includes("(publickey")) {
    return "回连已通但本机无法执行 pk：请确认 pk 文件完整与执行位；排除后重跑本配置";
  }
  if (out.includes("denied")) {
    return "认证被拒：重跑一次本配置（公钥装配与私钥推送需同时生效），或检查本机 authorized_keys";
  }
  return "看 detail 中的 ssh 报错定位";
}
