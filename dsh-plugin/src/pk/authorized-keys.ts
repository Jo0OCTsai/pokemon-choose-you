/**
 * authorized_keys 装配（从 setup.ts 拆件控复杂度；对齐 remote_pk.rs 的
 * authorized_entry / assemble_authorized_keys / append_authorized_entry）：
 * 四形态收口——整条一致 skip / 旧版裸公钥行原位升级 / 自家受限条目旧路径原位搬移 /
 * 陌生自定义形态保持不动；都不在则追加新受限条目。
 */
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { SetupCtx, SetupStep } from "./setup";
import { posixQuote } from "./shim";

const isWindows = process.platform === "win32";

/** authorized_keys 受限条目（authorized_entry 同构）：restrict + forced command 指向
 * __ssh_entry；选项值里的 `\` 与 `"` 按 sshd 规则转义（Windows 路径反斜杠整体加倍） */
export function authorizedEntry(pkPath: string, pubLine: string): string {
  const forced = isWindows ? `"${pkPath}" __ssh_entry` : `${posixQuote(pkPath)} __ssh_entry`;
  const escaped = forced.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `restrict,command="${escaped}" ${pubLine}`;
}

/** 装配结果形态（四形态收口的判定与执行分离） */
type AkAction =
  { kind: "skip"; detail: string } | { kind: "replace"; lines: string[]; detail: string } | { kind: "append" };

/** 判定既有 authorized_keys 对该公钥的处置（纯函数） */
function planAction(existing: string, entry: string, pubLine: string): AkAction {
  const lines = existing.split("\n");
  if (lines.some((l) => l.trim() === entry)) {
    return { kind: "skip", detail: "authorized_keys 已含该公钥（restrict,command= 受限条目）" };
  }
  if (lines.some((l) => l.trim() === pubLine)) {
    // 旧版本写入的裸公钥行：原位替换为我们自己的受限条目（其余行不动）
    return {
      kind: "replace",
      lines: lines.map((l) => (l.trim() === pubLine ? entry : l)),
      detail: "旧裸公钥已升级为受限条目（restrict,command=，仅可执行本机 pk）",
    };
  }
  if (lines.some((l) => l.includes(pubLine))) {
    // 自家受限条目旧 pk 路径 → 原位搬移 command；陌生自定义形态 → 保持不动
    const isOursStale = (l: string): boolean => {
      const t = l.trim();
      return t.startsWith('restrict,command="') && t.endsWith(` ${pubLine}`) && t.includes("__ssh_entry");
    };
    if (lines.some(isOursStale)) {
      return {
        kind: "replace",
        lines: lines.map((l) => (isOursStale(l) ? entry : l)),
        detail: "受限条目 command 已随本次 pk 路径更新（旧路径会让回连被 __ssh_entry 拒绝）",
      };
    }
    return {
      kind: "skip",
      detail:
        "authorized_keys 已含该公钥（自定义限制条目，保持不动；若端到端验证失败，请检查该条目的 command 是否指向本机 pk 的 __ssh_entry）",
    };
  }
  return { kind: "append" };
}

/** 装配入口（run_setup 步骤 4）：返回 false = 写失败（fail 步已入 steps） */
export function assembleAuthorizedKeys(ctx: SetupCtx, pubLine: string, steps: SetupStep[]): boolean {
  const sshDir = join(ctx.localHome, ".ssh");
  const ak = join(sshDir, "authorized_keys");
  const entry = authorizedEntry(ctx.pkPath, pubLine);
  let existing = "";
  try {
    existing = readFileSync(ak, "utf8");
  } catch {
    // 不存在按空处理
  }
  const action = planAction(existing, entry, pubLine);
  if (action.kind === "skip") {
    steps.push({ name: "本机公钥装配", status: "skip", detail: action.detail });
    return true;
  }
  if (action.kind === "replace") {
    try {
      writeFileSync(ak, `${action.lines.join("\n")}\n`);
    } catch (e) {
      steps.push({
        name: "本机公钥装配",
        status: "fail",
        detail: `更新 ${ak} 失败：${e instanceof Error ? e.message : String(e)}`,
      });
      return false;
    }
    steps.push({ name: "本机公钥装配", status: "ok", detail: `${action.detail}：${ak}` });
    return true;
  }
  const err = appendAuthorizedEntry(ctx, sshDir, ak, entry);
  if (err !== null) {
    steps.push({ name: "本机公钥装配", status: "fail", detail: err });
    return false;
  }
  steps.push({ name: "本机公钥装配", status: "ok", detail: `已追加到 ${ak}` });
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
    return null;
  }
  // Windows OpenSSH 对 authorized_keys 的 ACL 极严（仅当前用户可读），尽力修复
  try {
    execFileSync("icacls", [ak, "/inheritance:r", "/grant", `${ctx.localUser}:(F)`], { timeout: 10_000 });
  } catch {
    // 同 Rust：尽力修复，失败不阻断
  }
  return null;
}
