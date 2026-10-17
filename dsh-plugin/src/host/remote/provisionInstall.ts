/**
 * 开通向导 upload / verify 两步执行器（从 provision.ts 拆出——棘轮 max-lines，等量
 * 迁移；provision.ts 为统一再出口，消费面不变）。upload 语义 = 远端 npm 闭包安装
 * dsh-ssh 家族（spike 修正 C——lib/helper.js 是分包产物非自包含单文件，单文件上传
 * 不可行）；verify = 远端 sha256sum 与权威源（运行时读本地制品计算）比对。
 */
import { nowRfc3339 } from "../storage/db";
import type { DeploymentEntity } from "./deployments";
import {
  defaultHelperPath,
  initialProvisionState,
  installDirFromHelperPath,
  npmInstallCommand,
  npmProbeCommand,
  sha256Command,
  sshFamilySpec,
} from "./provisionCommands";
import type { HelperArtifactInfo, ProvisionDeps } from "./provision";
import { failOutcome, liveScope, parseSha256, type StepOutcome } from "./provisionSteps";
import type { SshScope } from "./sshScope";

const NPM_INSTALL_HINT =
  "步③ 经 npm 在远端安装 dsh-ssh 运行时闭包：远端需可达 npm 且 npm 与 node 同目录或入 PATH（随 Node ≥ 20 附带）且可达 npm registry；离线远端暂不支持（全量树上传为未来增强，见 docs/debt.md）";
const MISMATCH_HINT =
  "远端 helper 摘要与预期不符：重跑向导重新安装；如确认降级 ShellRunner 直连须显式确认（deploymentDegradeConfirm）";

/** 摘要不符落库（拒绝就绪不降级直连——D31；强制 upload 重置 → 下轮重跑重新安装） */
export function markHelperMismatch(entity: DeploymentEntity, message: string, now = nowRfc3339()): DeploymentEntity {
  const state = entity.provision ?? initialProvisionState();
  const steps = state.steps;
  return {
    ...entity,
    status: "not_ready",
    lastError: message,
    provision: {
      ...state,
      steps: {
        ...steps,
        upload: { status: "pending", at: "" },
        verify: { status: "failed", tag: "HELPER_HASH_MISMATCH", message, at: now },
      },
    },
  };
}

/**
 * 远端 npm 探测（优先 node 同目录 sibling npm，回落 command -v；首行须绝对路径——
 * 按行解析保路径可含空格；失败/执行异常 = 该步失败信封）。
 */
async function probeRemoteNpm(scope: SshScope, nodePath: string): Promise<string | StepOutcome> {
  try {
    const probe = await scope.shell(npmProbeCommand(nodePath));
    const candidate = (probe.stdout.trim().split("\n")[0] ?? "").trim();
    if (probe.code !== 0 || !candidate.startsWith("/")) {
      return failOutcome(
        "upload",
        "PROVISION_STEP_FAILED",
        "远端 npm 探测失败（与 node 不同目录且不在 PATH）",
        NPM_INSTALL_HINT,
      );
    }
    return candidate;
  } catch (error) {
    return failOutcome(
      "upload",
      "PROVISION_STEP_FAILED",
      `远端 npm 探测执行失败：${String(error).slice(0, 160)}`,
      NPM_INSTALL_HINT,
    );
  }
}

/** npm 闭包安装执行（exit 非 0 / 执行异常 = 该步失败信封；成功 = null） */
async function installSshClosure(
  scope: SshScope,
  npmPath: string,
  nodePath: string,
  helperPath: string,
  version: string,
): Promise<StepOutcome | null> {
  try {
    const install = await scope.shell(
      npmInstallCommand(npmPath, installDirFromHelperPath(helperPath), sshFamilySpec(version), nodePath),
    );
    if (install.code !== 0) {
      return failOutcome(
        "upload",
        "PROVISION_STEP_FAILED",
        `npm 闭包安装失败（exit ${install.code}）：${install.stderr.slice(0, 160)}`,
        NPM_INSTALL_HINT,
      );
    }
    return null;
  } catch (error) {
    return failOutcome(
      "upload",
      "PROVISION_STEP_FAILED",
      `npm 闭包安装执行失败：${String(error).slice(0, 160)}`,
      NPM_INSTALL_HINT,
    );
  }
}

/**
 * 步③ upload（语义 = runtime 闭包安装，spike 修正 C）：远端 npm 探测 →
 * `npm install --prefix <安装目录> @deepseek-ai/dsh-ssh@<闭包版本>`——平台
 * optionalDeps/prebuild 由 npm 选择；远端 npm 不可达/未安装 = 该步失败
 * （与断网同语义）；helperPath = <安装目录>/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js。
 */
export async function execUpload(entity: DeploymentEntity, deps: ProvisionDeps): Promise<StepOutcome> {
  const helperPath =
    entity.helperPath !== ""
      ? entity.helperPath
      : defaultHelperPath(entity.provision?.homeDir ?? "", deps.pluginVersion);
  if (!helperPath.startsWith("/")) {
    return failOutcome(
      "upload",
      "PROVISION_STEP_FAILED",
      "helperPath 缺少展开基准（远端 $HOME 未探测）——重跑向导从第一步继续",
    );
  }
  let artifact: HelperArtifactInfo;
  try {
    artifact = deps.readHelperArtifact();
  } catch (error) {
    return failOutcome("upload", "PROVISION_STEP_FAILED", `本地 helper 制品读取失败：${String(error).slice(0, 160)}`);
  }
  const got = await liveScope(entity, deps);
  if ("unavailable" in got) {
    return failOutcome("upload", "PROVISION_STEP_FAILED", `远端连接不可用：${got.unavailable}`);
  }
  const npmPath = await probeRemoteNpm(got.scope, entity.nodePath);
  if (typeof npmPath !== "string") {
    return npmPath;
  }
  const installFailure = await installSshClosure(got.scope, npmPath, entity.nodePath, helperPath, artifact.version);
  if (installFailure !== null) {
    return installFailure;
  }
  const at = nowRfc3339();
  return {
    ok: true,
    message: `已安装闭包 ${helperPath}`,
    apply(e) {
      const state = e.provision ?? initialProvisionState();
      return {
        ...e,
        helperPath,
        status: "installing",
        provision: { ...state, steps: { ...state.steps, upload: { status: "ok", message: helperPath, at } } },
      };
    },
  };
}

/** 远端摘要复核执行（exit 非 0 / 异常 / 输出不可解析 = 失败信封；成功 = hex 小写） */
async function fetchRemoteSha256(scope: SshScope, helperPath: string): Promise<string | StepOutcome> {
  let remote: string | null = null;
  try {
    const result = await scope.shell(sha256Command(helperPath));
    if (result.code !== 0) {
      return failOutcome(
        "verify",
        "PROVISION_STEP_FAILED",
        `摘要复核执行失败（exit ${result.code}，如远端缺 sha256sum）：${result.stderr.slice(0, 120)}`,
      );
    }
    remote = parseSha256(result.stdout);
  } catch (error) {
    return failOutcome("verify", "PROVISION_STEP_FAILED", `摘要复核执行失败：${String(error).slice(0, 160)}`);
  }
  if (remote === null) {
    return failOutcome("verify", "PROVISION_STEP_FAILED", "摘要复核输出无法解析（sha256sum 首段非 64 位 hex）");
  }
  return remote;
}

/** 步④ verify：远端 sha256sum 与权威源（运行时读本地制品计算）比对 */
export async function execVerify(entity: DeploymentEntity, deps: ProvisionDeps): Promise<StepOutcome> {
  const helperPath = entity.helperPath;
  let expected = "";
  try {
    expected = deps.readHelperArtifact().sha256.toLowerCase();
  } catch (error) {
    return failOutcome("verify", "PROVISION_STEP_FAILED", `本地 helper 制品读取失败：${String(error).slice(0, 160)}`);
  }
  const got = await liveScope(entity, deps);
  if ("unavailable" in got) {
    return failOutcome("verify", "PROVISION_STEP_FAILED", `远端连接不可用：${got.unavailable}`);
  }
  const remote = await fetchRemoteSha256(got.scope, helperPath);
  if (typeof remote !== "string") {
    return remote;
  }
  const mismatchMessage = `远端 helper 摘要不符（远端 ${remote} ≠ 预期 ${expected}）`;
  if (remote !== expected) {
    // 摘要不符：拒绝就绪、不降级直连（D31）；upload 重置 → 下轮重跑重新安装
    return {
      ok: false,
      tag: "HELPER_HASH_MISMATCH",
      message: mismatchMessage,
      hint: MISMATCH_HINT,
      apply(e) {
        return markHelperMismatch(e, mismatchMessage);
      },
    };
  }
  const at = nowRfc3339();
  return {
    ok: true,
    message: `摘要一致（${expected}）`,
    apply(e) {
      const state = e.provision ?? initialProvisionState();
      return {
        ...e,
        status: "ready",
        helperHash: expected,
        lastError: null,
        provision: { ...state, steps: { ...state.steps, verify: { status: "ok", message: expected, at } } },
      };
    },
  };
}
