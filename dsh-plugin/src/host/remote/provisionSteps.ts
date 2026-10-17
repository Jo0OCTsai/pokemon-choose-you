/**
 * 开通向导步骤执行 infra + probe 两步执行器（从 provision.ts 拆出——棘轮 max-lines，
 * 等量迁移；provision.ts 为统一再出口，消费面不变）。upload/verify 两步在
 * provisionInstall.ts；远端操作全部事务外编排（事务内禁止 SSH 调用）。
 */
import { nowRfc3339 } from "../storage/db";
import type { DeploymentEntity } from "./deployments";
import { homeProbeCommand, initialProvisionState, probeNodeCommand } from "./provisionCommands";
import type { ProvisionDeps, ProvisionErrorTag, ProvisionState, ProvisionStep } from "./provision";
import type { SshScope } from "./sshScope";

// ---- 步骤执行（事务外远端编排） ----

/** 单步执行产物：结果信封 + 实体变更闭包（事务内应用到新鲜实体） */
export interface StepOutcome {
  ok: boolean;
  tag?: ProvisionErrorTag;
  message?: string;
  hint?: string;
  apply(entity: DeploymentEntity): DeploymentEntity;
}

/** 失败落库通用闭包（步骤记 failed + 状态回落 not_ready + lastError） */
export function failOutcome(step: ProvisionStep, tag: ProvisionErrorTag, message: string, hint?: string): StepOutcome {
  const at = nowRfc3339();
  return {
    ok: false,
    tag,
    message,
    hint,
    apply(entity) {
      const state = entity.provision ?? initialProvisionState();
      const withStep: ProvisionState = {
        ...state,
        steps: { ...state.steps, [step]: { status: "failed", tag, message, at } },
      };
      return { ...entity, status: "not_ready", lastError: message, provision: withStep };
    },
  };
}

const SSH_AUTH_HINT = "先完成免密配置：ssh-copy-id <别名>（或把密钥加入 agent），完成后重试开通向导";
const NODE_INSTALL_HINT = "远端未找到可用 Node——先在远端安装 Node.js（版本 ≥ 20）再重试";

/** 解析 sha256sum 输出首 token（hex 小写；解析不出 = null） */
export function parseSha256(stdout: string): string | null {
  const token = stdout.trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

/** 取 scope 并保证 connected（不可达时返回失败文案，由各步映射为自己的错误 tag） */
export async function liveScope(
  entity: DeploymentEntity,
  deps: ProvisionDeps,
): Promise<{ scope: SshScope } | { unavailable: string }> {
  let scope: SshScope | null = null;
  try {
    scope = await deps.scopeFor(entity);
  } catch (error) {
    return { unavailable: `连接建立失败：${String(error).slice(0, 160)}` };
  }
  if (scope === null || !scope.connected) {
    return { unavailable: "连接不可用（免密未配置或已断开）" };
  }
  return { scope };
}

/** 步① probe-ssh：免密探测 + 远端 $HOME 探测（失败 → SSH_AUTH_REQUIRED 语义） */
export async function execProbeSsh(entity: DeploymentEntity, deps: ProvisionDeps): Promise<StepOutcome> {
  const got = await liveScope(entity, deps);
  if ("unavailable" in got) {
    return failOutcome("probe-ssh", "SSH_AUTH_REQUIRED", `免密探测失败：${got.unavailable}`, SSH_AUTH_HINT);
  }
  let code = -1;
  let stdout = "";
  try {
    const result = await got.scope.shell(homeProbeCommand());
    code = result.code;
    stdout = result.stdout;
  } catch (error) {
    return failOutcome("probe-ssh", "SSH_AUTH_REQUIRED", `免密探测失败：${String(error).slice(0, 160)}`, SSH_AUTH_HINT);
  }
  const homeDir = stdout.trim();
  if (code !== 0 || !homeDir.startsWith("/")) {
    return failOutcome(
      "probe-ssh",
      "SSH_AUTH_REQUIRED",
      code !== 0 ? `免密探测失败（exit ${code}）` : "远端 $HOME 探测结果异常（非绝对路径）",
      SSH_AUTH_HINT,
    );
  }
  const at = nowRfc3339();
  return {
    ok: true,
    message: `免密连通，远端 HOME = ${homeDir}`,
    apply(e) {
      const state = e.provision ?? initialProvisionState();
      return {
        ...e,
        status: "probing",
        provision: {
          ...state,
          homeDir,
          steps: { ...state.steps, "probe-ssh": { status: "ok", message: `HOME = ${homeDir}`, at } },
        },
      };
    },
  };
}

/** 步② probe-node：`<nodePath> --version` 引号全量引用 */
export async function execProbeNode(entity: DeploymentEntity, deps: ProvisionDeps): Promise<StepOutcome> {
  const got = await liveScope(entity, deps);
  if ("unavailable" in got) {
    return failOutcome("probe-node", "PROVISION_STEP_FAILED", `远端连接不可用：${got.unavailable}`);
  }
  let code = -1;
  let stdout = "";
  try {
    const result = await got.scope.shell(probeNodeCommand(entity.nodePath));
    code = result.code;
    stdout = result.stdout;
  } catch (error) {
    return failOutcome("probe-node", "PROVISION_STEP_FAILED", `Node 探测执行失败：${String(error).slice(0, 160)}`);
  }
  if (code !== 0) {
    return failOutcome(
      "probe-node",
      "PROVISION_STEP_FAILED",
      `远端 Node 探测失败（exit ${code}，路径 ${entity.nodePath}）`,
      NODE_INSTALL_HINT,
    );
  }
  const version = stdout.trim().slice(0, 60);
  const at = nowRfc3339();
  return {
    ok: true,
    message: `Node ${version}`,
    apply(e) {
      const state = e.provision ?? initialProvisionState();
      return {
        ...e,
        status: "installing",
        provision: { ...state, steps: { ...state.steps, "probe-node": { status: "ok", message: version, at } } },
      };
    },
  };
}
