/**
 * remote setup 九步幂等开通（对齐 commands/remote_pk.rs 的 run_setup，ADR-0006 双实现）：
 * 定位 pk → 本机 sshd → 专用密钥 → 公钥装配（四形态收口）→ 推私钥 → 预信任指纹 →
 * 安装 shim → 远程 PATH → 端到端验证 + ControlPersist 收尾。任一步失败即停，
 * 报告到失败步为止（SetupReport 与 Rust 实现同构：camelCase ok/steps[]/version）。
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { execFileSync } from "node:child_process";
import { keyscanLocal, sshRun, type SshCtx } from "./ssh";

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

/** POSIX 单引号引用（shim 行内路径交给本机登录 shell 重解析；posix_quote 同构） */
export function posixQuote(s: string): string {
  const safe = s !== "" && /^[A-Za-z0-9\-_./=@:%+]+$/.test(s);
  return safe ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

const isWindows = process.platform === "win32";

/** shim 脚本内容（shim_script 同构）：经反向隧道回本机执行，pk 绝对路径内嵌 */
export function shimScript(pkPath: string, tunnelPort: number, localUser: string): string {
  const quotedPk = isWindows
    ? // 本机 sshd 默认 shell 是 cmd：含空格的路径用双引号
      pkPath.includes(" ")
      ? `"${pkPath}"`
      : pkPath
    : posixQuote(pkPath);
  // unix 本机：PK_* 已设置时以 env 前缀带回（值含空格安全：远端求值时已加引号）
  const [envFwd, tail] = isWindows
    ? ["", `${quotedPk} "$@"`]
    : [
        'fwd=env\n[ -n "$PK_LOG_FILE" ] && fwd="$fwd PK_LOG_FILE=\\"$PK_LOG_FILE\\""\n[ -n "$PK_DISPATCH_TASK" ] && fwd="$fwd PK_DISPATCH_TASK=$PK_DISPATCH_TASK"\n',
        `"$fwd ${quotedPk}" "$@"`,
      ];
  return (
    `#!/bin/sh\n` +
    `# pk 远程透传 shim（就决定是你了一键配置生成）：经应用建立的反向隧道回本机执行，数据始终留在本机。\n` +
    `# 连接复用：首调建 ControlMaster，后续调用毫秒级；环境透传见下方 fwd 段。\n` +
    `${envFwd}` +
    `exec ssh -o BatchMode=yes -o ConnectTimeout=10 \\\n` +
    `-o ControlMaster=auto -o ControlPath="/tmp/pk-shim-$(id -u)-%C" -o ControlPersist=10m \\\n` +
    `-i "$HOME/.ssh/pk_shim" -p ${tunnelPort} ${posixQuote(`${localUser}@127.0.0.1`)} ${tail}\n`
  );
}

/** authorized_keys 受限条目（authorized_entry 同构）：restrict + forced command 指向
 * __ssh_entry；选项值里的 `\` 与 `"` 按 sshd 规则转义（Windows 路径反斜杠整体加倍） */
export function authorizedEntry(pkPath: string, pubLine: string): string {
  const forced = isWindows ? `"${pkPath}" __ssh_entry` : `${posixQuote(pkPath)} __ssh_entry`;
  const escaped = forced.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `restrict,command="${escaped}" ${pubLine}`;
}

/** ssh-keyscan 输出 → known_hosts 条目：主机名改写为 [127.0.0.1]:隧道端口 */
export function toKnownHostsLines(keyscan: string, tunnelPort: number): string {
  let out = "";
  for (const raw of keyscan.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    out += sp >= 0 ? `[127.0.0.1]:${tunnelPort} ${line.slice(sp + 1)}\n` : `${line}\n`;
  }
  return out;
}

/** 专用密钥文件对（key_dir 下的固定名） */
function keyFiles(keyDir: string): [string, string] {
  return [join(keyDir, "remote_pk_shim_ed25519"), `${join(keyDir, "remote_pk_shim_ed25519")}.pub`];
}

/** 端到端验证的远端命令行（verify_remote_line 同构）：跑 pk --version 后立刻关闭
 * shim 的 ControlPersist master——master 攥着临时 -R 隧道不放手则 setup 永久挂起 */
export function verifyRemoteLine(): string {
  return (
    `"$SHELL" -lc 'pk --version'; rc=$?; ` +
    `for s in $(find "$HOME/.ssh" /tmp -maxdepth 1 -name 'pk-shim-*' 2>/dev/null); do ` +
    `[ -S "$s" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 -o "ControlPath=$s" ` +
    `-O exit 127.0.0.1 2>/dev/null; done; ` +
    `pkill -f 'pk-shim-.* \\[mux\\]' 2>/dev/null; ` +
    `exit $rc`
  );
}

/** 执行一键配置序列（任一步失败即停，报告到失败步为止；失败都在报告里） */
export function runSetup(ctx: SetupCtx): SetupReport {
  const steps: SetupStep[] = [];
  const reportOf = (version: string | null): SetupReport => ({ ok: false, steps, version });
  const failStep = (name: string, detail: string): SetupReport => {
    steps.push({ name, status: "fail", detail });
    return reportOf(null);
  };

  // 1. 本机 pk 定位（存在、非空占位、可执行；unix 无执行位自动补）
  if (!existsSync(ctx.pkPath)) {
    return failStep("定位 pk", `未找到本机 pk：${ctx.pkPath}（仅安装版应用支持一键配置）`);
  }
  let size = 0;
  try {
    size = statSync(ctx.pkPath).size;
  } catch (e) {
    return failStep("定位 pk", `读取 ${ctx.pkPath} 失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (size === 0) {
    return failStep("定位 pk", `${ctx.pkPath} 是空占位文件。安装版应用无此问题；开发态请确认分发产物完整后重试`);
  }
  let pkDetail = "";
  if (!isWindows) {
    const mode = statSync(ctx.pkPath).mode;
    if ((mode & 0o111) === 0) {
      // 占位拷贝常不带执行位；顺手补上（同用户可写，一般都能成功）
      let fixed = true;
      try {
        chmodSync(ctx.pkPath, (mode & 0o777) | 0o755);
      } catch {
        fixed = false;
      }
      if (!fixed) {
        return failStep("定位 pk", `${ctx.pkPath} 无执行权限且自动补权失败，请手动 chmod +x`);
      }
      pkDetail = "（已自动补执行权限）";
    }
  }
  steps.push({ name: "定位 pk", status: "ok", detail: `${ctx.pkPath}${pkDetail}` });

  // 2. 本机 sshd 可达（隧道终点；只扫端口不认证）
  const hostKeys = keyscanLocal(ctx.keyscanProgram, 10_000);
  if (hostKeys === null) {
    return failStep(
      "本机 sshd",
      "本机 22 端口无应答——请先开启 sshd（隧道终点，只需本机回环可达，防火墙无需放行）：macOS 系统设置 → 通用 → 共享 → 远程登录；Windows 安装并启动「OpenSSH SSH 服务器」；Linux `sudo systemctl enable --now sshd`",
    );
  }
  steps.push({ name: "本机 sshd", status: "ok", detail: "22 端口可达（仅回环即可）" });

  // 3. 专用密钥：已有则复用，缺则生成（幂等）
  const [keyPriv, keyPub] = keyFiles(ctx.keyDir);
  if (existsSync(keyPriv) && existsSync(keyPub)) {
    steps.push({ name: "专用密钥", status: "skip", detail: `复用已有密钥 ${keyPriv}` });
  } else {
    try {
      mkdirSync(ctx.keyDir, { recursive: true });
    } catch {
      // 目录已存在或不可建——生成步骤会给出具体失败
    }
    let genErr = "";
    try {
      execFileSync(
        ctx.sshKeygenProgram,
        ["-t", "ed25519", "-N", "", "-C", "pokemon-knock remote pk shim", "-f", keyPriv],
        { encoding: "utf8", timeout: 30_000 },
      );
    } catch (e) {
      genErr = e instanceof Error ? e.message : String(e);
    }
    if (genErr !== "") {
      return failStep("专用密钥", `ssh-keygen 生成失败（需 OpenSSH 客户端）：${genErr}`);
    }
    steps.push({ name: "专用密钥", status: "ok", detail: `已生成 ${keyPriv}` });
  }
  let pubLine = "";
  let privText = "";
  try {
    pubLine = readFileSync(keyPub, "utf8").trim();
    privText = readFileSync(keyPriv, "utf8");
  } catch {
    return failStep("专用密钥", "密钥文件不可读");
  }
  if (pubLine === "") return failStep("专用密钥", "密钥文件不可读");

  // 4. 公钥装配本机 authorized_keys（幂等；四形态收口）
  if (!assembleAuthorizedKeys(ctx, pubLine, steps)) return reportOf(null);

  // 5. 私钥推到远程（载荷走 stdin 不经远端 shell 重解析）
  const [pushOk, pushErr] = sshRun(
    ctx,
    [],
    'umask 077 && mkdir -p "$HOME/.ssh" && cat > "$HOME/.ssh/pk_shim" && chmod 600 "$HOME/.ssh/pk_shim"',
    privText,
  );
  if (!pushOk) {
    return failStep("推送私钥", `经 ssh 写远程 ~/.ssh/pk_shim 失败：${pushErr}（确认 agent 的 SSH 配置可免密登录）`);
  }
  steps.push({ name: "推送私钥", status: "ok", detail: "远程 ~/.ssh/pk_shim（600）" });

  // 6. 预信任主机指纹（shim 走 BatchMode，首次连接交互确认必失败，必须预先信任）
  const khEntries = toKnownHostsLines(hostKeys, ctx.tunnelPort);
  const [khOk, khErr] = sshRun(
    ctx,
    [],
    `mkdir -p "$HOME/.ssh" && touch "$HOME/.ssh/known_hosts" && chmod 600 "$HOME/.ssh/known_hosts"; ` +
      `ssh-keygen -R "[127.0.0.1]:${ctx.tunnelPort}" -f "$HOME/.ssh/known_hosts" 2>/dev/null; ` +
      `cat >> "$HOME/.ssh/known_hosts"`,
    khEntries,
  );
  if (!khOk) {
    return failStep("预信任主机指纹", `写远程 known_hosts 失败：${khErr}`);
  }
  steps.push({
    name: "预信任主机指纹",
    status: "ok",
    detail: `[127.0.0.1]:${ctx.tunnelPort}（隧道终点的本机 sshd）`,
  });

  // 7. 安装 shim 到远程 ~/.local/bin（内嵌本机 pk 绝对路径与隧道端口）
  const script = shimScript(ctx.pkPath, ctx.tunnelPort, ctx.localUser);
  const [shimOk, shimErr] = sshRun(
    ctx,
    [],
    'umask 022 && mkdir -p "$HOME/.local/bin" && cat > "$HOME/.local/bin/pk" && chmod 755 "$HOME/.local/bin/pk"',
    script,
  );
  if (!shimOk) {
    return failStep("安装 shim", `写远程 ~/.local/bin/pk 失败：${shimErr}`);
  }
  steps.push({
    name: "安装 shim",
    status: "ok",
    detail: "远程 ~/.local/bin/pk（若同一远程配多个 agent，请保持相同隧道端口）",
  });

  // 8. 远程登录 shell 的 PATH 能找到 pk；不能则补 ~/.profile 等再验
  const [found] = sshRun(ctx, [], "exec \"$SHELL\" -lc 'command -v pk'", null);
  if (found) {
    steps.push({
      name: "远程 PATH",
      status: "ok",
      // 口径注明：本步验证登录 shell；agent 实际跑在非登录 shell，其 PATH 由派发
      // 脚本前插 ~/.local/bin 兜底保证——两径独立
      detail: "登录 shell 已能找到 pk（agent 非登录执行链另由派发兜底段保证 ~/.local/bin 可达）",
    });
  } else {
    const ensure =
      "for f in .profile .zprofile .bash_profile; do grep -qs '.local/bin' \"$HOME/$f\" 2>/dev/null || " +
      'printf \'\\nexport PATH="$HOME/.local/bin:$PATH"\\n\' >> "$HOME/$f"; done; ' +
      "exec \"$SHELL\" -lc 'command -v pk'";
    const [ok2, out2] = sshRun(ctx, [], ensure, null);
    if (ok2 && out2.trim() !== "") {
      steps.push({ name: "远程 PATH", status: "ok", detail: `已补 PATH（${out2.trim()}）` });
    } else {
      return failStep("远程 PATH", "已尝试补 PATH 但登录 shell 仍找不到 pk，请在远程手动确认 ~/.local/bin 可用");
    }
  }

  // 9. 端到端验证：真实开一条带 -R 的 ssh 连接执行 pk --version——shim 真回连一次本机
  const [verifyOk, verifyOut] = sshRun(
    ctx,
    ["-R", `127.0.0.1:${ctx.tunnelPort}:127.0.0.1:22`],
    verifyRemoteLine(),
    null,
  );
  const version = verifyOut.trim();
  if (verifyOk && version !== "") {
    steps.push({ name: "端到端验证", status: "ok", detail: `远程经隧道回本机执行成功（pk ${version}）` });
    return { ok: true, steps, version };
  }
  const out = verifyOut;
  let hint: string;
  if (out.includes("refused")) {
    hint = "隧道端口未通（本步自动建立临时隧道，失败多为 sshd 仅监听 IPv6 或被安全软件拦截）";
  } else if (out.toLowerCase().includes("permission denied") && !out.includes("(publickey")) {
    hint = "回连已通但本机无法执行 pk：请确认 pk 文件完整与执行位；排除后重跑本配置";
  } else if (out.includes("denied")) {
    hint = "认证被拒：重跑一次本配置（公钥装配与私钥推送需同时生效），或检查本机 authorized_keys";
  } else {
    hint = "看 detail 中的 ssh 报错定位";
  }
  steps.push({ name: "端到端验证", status: "fail", detail: `远程 pk --version 未返回版本：${out}（${hint}）` });
  return reportOf(null);
}

/** authorized_keys 装配（四形态收口）：整条一致 skip / 旧版裸公钥行原位升级 /
 * 自家受限条目旧路径原位搬移 / 陌生自定义形态保持不动；都不在则追加新受限条目 */
function assembleAuthorizedKeys(ctx: SetupCtx, pubLine: string, steps: SetupStep[]): boolean {
  const failHere = (detail: string): boolean => {
    steps.push({ name: "本机公钥装配", status: "fail", detail });
    return false;
  };
  const push = (status: string, detail: string) => {
    steps.push({ name: "本机公钥装配", status, detail });
  };
  const sshDir = join(ctx.localHome, ".ssh");
  const ak = join(sshDir, "authorized_keys");
  const entry = authorizedEntry(ctx.pkPath, pubLine);
  let existing = "";
  try {
    existing = readFileSync(ak, "utf8");
  } catch {
    // 不存在按空处理
  }
  const lines = existing.split("\n");
  if (lines.some((l) => l.trim() === entry)) {
    push("skip", "authorized_keys 已含该公钥（restrict,command= 受限条目）");
  } else if (lines.some((l) => l.trim() === pubLine)) {
    // 旧版本写入的裸公钥行：原位替换为我们自己的受限条目（其余行不动）
    const upgraded = lines.map((l) => (l.trim() === pubLine ? entry : l)).join("\n");
    try {
      writeFileSync(ak, `${upgraded}\n`);
    } catch (e) {
      return failHere(`升级 ${ak} 中的旧条目失败：${e instanceof Error ? e.message : String(e)}`);
    }
    push("ok", `旧裸公钥已升级为受限条目（restrict,command=，仅可执行本机 pk）：${ak}`);
  } else if (lines.some((l) => l.includes(pubLine))) {
    // 自家受限条目但 command 指向别的 pk 路径 → 原位搬移；陌生自定义形态 → 保持不动
    const isOursStale = (l: string): boolean => {
      const t = l.trim();
      return t.startsWith('restrict,command="') && t.endsWith(` ${pubLine}`) && t.includes("__ssh_entry");
    };
    if (lines.some(isOursStale)) {
      const migrated = lines.map((l) => (isOursStale(l) ? entry : l)).join("\n");
      try {
        writeFileSync(ak, `${migrated}\n`);
      } catch (e) {
        return failHere(`更新 ${ak} 中的旧路径条目失败：${e instanceof Error ? e.message : String(e)}`);
      }
      push("ok", `受限条目 command 已随本次 pk 路径更新（旧路径会让回连被 __ssh_entry 拒绝）：${ak}`);
    } else {
      push(
        "skip",
        "authorized_keys 已含该公钥（自定义限制条目，保持不动；若端到端验证失败，请检查该条目的 command 是否指向本机 pk 的 __ssh_entry）",
      );
    }
  } else {
    const detail = appendAuthorizedEntry(ctx, sshDir, ak, entry);
    if (detail !== null) return failHere(detail);
    push("ok", `已追加到 ${ak}`);
  }
  return true;
}

/** 追加新受限条目并落权限（Windows ACL 尽力修复）。null = 成功，否则失败文案 */
function appendAuthorizedEntry(ctx: SetupCtx, sshDir: string, ak: string, entry: string): string | null {
  try {
    mkdirSync(sshDir, { recursive: true });
    appendFileSync(ak, `${entry}\n`);
  } catch (e) {
    return `写 ${ak} 失败：${e instanceof Error ? e.message : String(e)}`;
  }
  if (!isWindows) {
    try {
      chmodSync(sshDir, 0o700);
      chmodSync(ak, 0o600);
    } catch {
      // 权限位失败不阻断（与 Rust 尽力修复同口径）
    }
  } else {
    // Windows OpenSSH 对 authorized_keys 的 ACL 极严（仅当前用户可读），尽力修复
    try {
      execFileSync("icacls", [ak, "/inheritance:r", "/grant", `${ctx.localUser}:(F)`], {
        timeout: 10_000,
      });
    } catch {
      // 同 Rust：尽力修复，失败不阻断
    }
  }
  return null;
}

/** 缺省上下文组装（pk remote setup 的 CLI 侧缺省值） */
export function defaultCtx(opts: {
  host: string;
  tunnelPort: number;
  pkPath: string;
  keyDir: string;
  localUser?: string;
  timeoutSecs: number;
}): SetupCtx {
  return {
    sshProgram: sshProgramOf(),
    keyscanProgram: "ssh-keyscan",
    sshKeygenProgram: "ssh-keygen",
    host: opts.host,
    sshPort: 0,
    agentKey: null,
    stepTimeoutMs: opts.timeoutSecs * 1000,
    tunnelPort: opts.tunnelPort,
    localUser: opts.localUser ?? userInfo().username,
    pkPath: opts.pkPath,
    keyDir: opts.keyDir,
    localHome: userInfo().homedir,
  };
}

function sshProgramOf(): string {
  const v = process.env.PK_SSH_BIN;
  return v !== undefined && v.trim() !== "" ? v.trim() : "ssh";
}
