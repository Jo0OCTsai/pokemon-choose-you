/**
 * 常驻隧道 supervisor（remote/tunnelSupervisor，ADR-0003 §2）：keyOf/argv/sync 增删、让位与
 * 接管、持锁重连回归、自残留锁回收、状态日志去重、错误路径。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TunnelSupervisor,
  tunnelArgv,
  tunnelKeyOf,
  type TunnelKey,
  type TunnelTunings,
} from "../../src/host/remote/tunnelSupervisor";
import type { DeploymentEntity } from "../../src/host/remote/deployments";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-tsup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entity(over: Partial<DeploymentEntity>): DeploymentEntity {
  return {
    id: "d1",
    alias: "gpu-1",
    nodePath: "/usr/bin/node",
    helperPath: "",
    helperHash: null,
    workdir: "",
    note: "",
    status: "draft",
    lastError: null,
    provision: null,
    degraded: false,
    pkTunnel: null,
    ...over,
  };
}

const ON = { port: 10022, persistent: true };
const KEY: TunnelKey = { deploymentId: "d1", alias: "gpu-1", tunnelPort: 10022 };

/** 快拍档（毫秒级退避/重查/健康判定，让多轮重连在 1s 内跑完） */
const FAST: TunnelTunings = {
  yieldRecheckMs: 100,
  backoffStartMs: 50,
  backoffMaxMs: 200,
  healthyAfterMs: 150,
  healthyHoldMs: 400,
};

describe("tunnelKeyOf", () => {
  it("未配 pkTunnel / 未开常驻 / 端口 0 / 别名空白都构不成身份", () => {
    expect(tunnelKeyOf(entity({ pkTunnel: null }))).toBeNull();
    expect(tunnelKeyOf(entity({ pkTunnel: { port: 10022, persistent: false } }))).toBeNull();
    expect(tunnelKeyOf(entity({ pkTunnel: { port: 0, persistent: true } }))).toBeNull();
    expect(tunnelKeyOf(entity({ alias: "  ", pkTunnel: ON }))).toBeNull();
  });

  it("完整配置 → 身份就位（别名去空白）", () => {
    expect(tunnelKeyOf(entity({ alias: " gpu-1 ", pkTunnel: ON }))).toEqual(KEY);
  });

  it("存量实体缺 pkTunnel 键（ADR-0003 之前落库）→ 按未配置处理不炸（回归：启动期 resync 抛 TypeError 崩宿主）", () => {
    const legacy = entity({ id: "d1" });
    delete (legacy as { pkTunnel?: DeploymentEntity["pkTunnel"] }).pkTunnel;
    expect("pkTunnel" in legacy).toBe(false);
    expect(tunnelKeyOf(legacy)).toBeNull();
    const sup = new TunnelSupervisor({ lockBase: dir });
    sup.sync([legacy]);
    expect(sup.statusOf("d1").state).toBe("off");
  });
});

describe("tunnelArgv", () => {
  it("autossh 配方 + alias 模式（无 -i/-p；-- 保护别名）", () => {
    const argv = tunnelArgv(KEY);
    const i = argv.indexOf("-R");
    expect(argv[i + 1]).toBe("127.0.0.1:10022:127.0.0.1:22");
    expect(argv).toContain("-N");
    expect(argv).toContain("ServerAliveInterval=10");
    expect(argv).toContain("ExitOnForwardFailure=yes");
    expect(argv).not.toContain("-i");
    expect(argv[argv.indexOf("--") + 1]).toBe("gpu-1");
  });
});

function fakeSsh(mode: "live" | "die"): string {
  const p = join(dir, `ssh-${mode}.sh`);
  writeFileSync(p, mode === "live" ? "#!/bin/sh\nsleep 10\n" : "#!/bin/sh\necho 'port forward failed' >&2\nexit 255\n");
  chmodSync(p, 0o755);
  return p;
}

async function waitUntil(
  sup: TunnelSupervisor,
  id: string,
  pred: (s: { state: string }) => boolean,
  ms = 6000,
): Promise<{ state: string; detail: string }> {
  const start = Date.now();
  for (;;) {
    const s = sup.statusOf(id);
    if (pred(s) || Date.now() - start > ms) return s;
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** 伪造外部宿主持有的锁目录：同进程 pid 会被自残留回收路径接管，测不了让位 */
function stageHolderLock(base: string): ReturnType<typeof spawn> {
  const holder = spawn("sleep", ["30"]);
  mkdirSync(join(base, "tunnels", "d1"), { recursive: true });
  writeFileSync(join(base, "tunnels", "d1", "pid"), String(holder.pid));
  return holder;
}

describe("TunnelSupervisor · sync 与状态", () => {
  it("sync 与注册表对齐：未开常驻不产生隧道；移除后期望集即停", () => {
    const sup = new TunnelSupervisor({ lockBase: dir });
    sup.sync([entity({ id: "d1", pkTunnel: { port: 10022, persistent: false } })]);
    expect(sup.statusOf("d1").state).toBe("off");
    sup.sync([]);
    expect(sup.statusOf("d1").state).toBe("off");
  });

  it("秒退假 ssh → retrying（stderr 尾行进详情）", async () => {
    const sup = new TunnelSupervisor({ sshBin: fakeSsh("die"), lockBase: join(dir, "b2") });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      const s = await waitUntil(sup, "d1", (x) => x.state === "retrying");
      expect(s.detail).toContain("port forward failed");
      expect(s.detail).toContain("重试");
    } finally {
      sup.stopAll();
    }
  });

  it("长连假 ssh → healthy（alias 进详情）", async () => {
    const sup = new TunnelSupervisor({ sshBin: fakeSsh("live"), lockBase: join(dir, "b3") });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      const s = await waitUntil(sup, "d1", (x) => x.state === "healthy", 8000);
      expect(s.state).toBe("healthy");
      expect(s.detail).toContain("gpu-1");
    } finally {
      sup.stopAll();
    }
  });
});

describe("TunnelSupervisor · 让位", () => {
  it("锁被存活宿主占住 → 让位待命（yielded，detail 指明持有者）", async () => {
    const holder = stageHolderLock(join(dir, "b1"));
    const sup = new TunnelSupervisor({ sshBin: fakeSsh("live"), lockBase: join(dir, "b1"), tunings: FAST });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      const s = await waitUntil(sup, "d1", (x) => x.state === "yielded");
      expect(s.state).toBe("yielded");
      expect(s.detail).toContain(String(holder.pid));
    } finally {
      sup.stopAll();
      holder.kill("SIGTERM");
    }
  });

  it("让位重查：持有方死亡后自动接管并连通", async () => {
    const holder = stageHolderLock(join(dir, "b-yield"));
    const sup = new TunnelSupervisor({ sshBin: fakeSsh("live"), lockBase: join(dir, "b-yield"), tunings: FAST });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      await waitUntil(sup, "d1", (x) => x.state === "yielded");
      holder.kill("SIGKILL"); // 模拟持有宿主退出（pid 探活转死）
      const s = await waitUntil(sup, "d1", (x) => x.state === "healthy", 8000);
      expect(s.state).toBe("healthy");
    } finally {
      sup.stopAll();
      holder.kill("SIGTERM");
    }
  }, 15000);
});

describe("TunnelSupervisor · 持锁重连（回归）", () => {
  it("ssh 退出后持锁重连——多轮退避仍持续拉起 ssh，不落入自让位（旧版重抢锁必判「pid=自己存活」而永久 yielded）", async () => {
    // 假 ssh 每次运行把自身 pid 落计数文件后秒退（退避循环里可统计拉起次数）
    const spawnsFile = join(dir, "spawns.txt");
    const p = join(dir, "ssh-die-count.sh");
    writeFileSync(p, `#!/bin/sh\necho $$ >> ${JSON.stringify(spawnsFile)}\necho 'port forward failed' >&2\nexit 255\n`);
    chmodSync(p, 0o755);
    const sup = new TunnelSupervisor({ sshBin: p, lockBase: join(dir, "b-regress"), tunings: FAST });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      // 轮询到 ≥3 次拉起即收（满载下子进程启动会被延迟，固定窗口易假阴）
      const observed = new Set<string>();
      const deadline = Date.now() + 8000;
      let spawns: string[] = [];
      while (Date.now() < deadline && spawns.length < 3) {
        observed.add(sup.statusOf("d1").state);
        spawns = existsSync(spawnsFile) ? readFileSync(spawnsFile, "utf8").trim().split("\n").filter(Boolean) : [];
        await new Promise((r) => setTimeout(r, 50));
      }
      observed.add(sup.statusOf("d1").state);
      expect(observed.has("yielded")).toBe(false);
      expect(spawns.length).toBeGreaterThanOrEqual(3);
      // ssh-pid 记账在锁目录（接管方清孤儿的依据），值为最近一次拉起的 pid
      const sshPid = readFileSync(join(dir, "b-regress", "tunnels", "d1", "ssh-pid"), "utf8").trim();
      expect(spawns).toContain(sshPid);
    } finally {
      sup.stopAll();
    }
  }, 20000);
});

describe("TunnelSupervisor · 自残留接管", () => {
  it("自残留锁（旧版泄漏：pid 文件 = 本进程、句柄已丢）→ 清理接管而非永久让位", async () => {
    mkdirSync(join(dir, "b-residue", "tunnels", "d1"), { recursive: true });
    writeFileSync(join(dir, "b-residue", "tunnels", "d1", "pid"), String(process.pid));
    const lines: Array<[string, string]> = [];
    const sup = new TunnelSupervisor({
      sshBin: fakeSsh("live"),
      lockBase: join(dir, "b-residue"),
      log: (l, m) => lines.push([l, m]),
      tunings: FAST,
    });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      const s = await waitUntil(sup, "d1", (x) => x.state === "healthy", 8000);
      expect(s.state).toBe("healthy");
      expect(lines.some(([l]) => l === "warn")).toBe(true);
    } finally {
      sup.stopAll();
    }
  }, 15000);
});
describe("TunnelSupervisor 状态迁移日志", () => {
  it("healthy 记 info 一行、connecting 不记", async () => {
    const lines: Array<[string, string]> = [];
    const sup = new TunnelSupervisor({
      sshBin: fakeSsh("live"),
      lockBase: join(dir, "b6"),
      log: (l, m) => lines.push([l, m]),
    });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      await waitUntil(sup, "d1", (x) => x.state === "healthy", 8000);
      expect(lines).toHaveLength(1);
      expect(lines[0][0]).toBe("info");
      expect(lines[0][1]).toContain("gpu-1");
      expect(lines[0][1]).toContain("10022");
    } finally {
      sup.stopAll();
    }
  });

  it("退避往复按 episode 去重：retrying 只记首行（warn），循环不再刷屏", async () => {
    const lines: Array<[string, string]> = [];
    const sup = new TunnelSupervisor({
      sshBin: fakeSsh("die"),
      lockBase: join(dir, "b7"),
      log: (l, m) => lines.push([l, m]),
    });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      await waitUntil(sup, "d1", (x) => x.state === "retrying");
      await new Promise((r) => setTimeout(r, 600)); // 退避 1s 内再进一两轮 connecting↔retrying
      expect(lines).toHaveLength(1);
      expect(lines[0][0]).toBe("warn");
      expect(lines[0][1]).toContain("port forward failed");
    } finally {
      sup.stopAll();
    }
  });
});

describe("TunnelSupervisor 错误路径", () => {
  it("sshBin 不存在 → spawn error 分支进 retrying（无法启动 ssh）", async () => {
    const sup = new TunnelSupervisor({ sshBin: join(dir, "no-such-ssh"), lockBase: join(dir, "b4") });
    try {
      sup.sync([entity({ id: "d1", pkTunnel: ON })]);
      const s = await waitUntil(sup, "d1", (x) => x.state === "retrying");
      expect(s.detail).toContain("无法启动 ssh");
    } finally {
      sup.stopAll();
    }
  });

  it("stopAll 幂等；stop 后 statusOf 归 off", () => {
    const sup = new TunnelSupervisor({ lockBase: join(dir, "b5") });
    sup.sync([entity({ id: "d1", pkTunnel: ON })]);
    sup.stopAll();
    sup.stopAll();
    expect(sup.statusOf("d1").state).toBe("off");
  });
});
