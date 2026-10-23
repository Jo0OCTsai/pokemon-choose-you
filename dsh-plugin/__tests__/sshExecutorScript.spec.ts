/**
 * remoteDispatchScript · 环境兜底 + CLI 解释形态分类（从 sshExecutorParts.spec.ts 拆出
 * ——棘轮 max-lines）：PATH 兜底段前插 ~/.local/bin（pk shim 落位目录——agent Bash 工具
 * 环境缺它时 pk 127，白名单 Bash(pk:*) 下 agent 无法自救）+ job.env/cd/exec 段序保持 +
 * classifyRemoteCliHead（ELF/node shebang/其他解释器三分支）。
 */
import { describe, expect, it } from "vitest";
import { classifyRemoteCliHead, remoteDispatchScript } from "../src/host/remote/sshExecutorScope";

describe("remoteDispatchScript · 环境兜底", () => {
  it("PATH 兜底段前插 ~/.local/bin（回归：agent Bash 工具缺该路径致 pk 127，白名单下 agent 无法自救）", () => {
    const out = remoteDispatchScript(
      { command: "claude", args: "-p {prompt}", prompt: "p", timeoutSecs: 120, workdir: "~/.choose-you/workspace" },
      "/home/vscode/.local/bin/claude",
      { nodePath: "/usr/bin/node", interpreter: "node" },
    );
    expect(out.script.startsWith('export PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"')).toBe(true);
  });

  it("~ 前缀 workdir：cd 段波浪号裸拼不进引号（回归：引号阻断远端 $HOME 展开）", () => {
    const out = remoteDispatchScript(
      { command: "claude", args: "-p {prompt}", prompt: "p", timeoutSecs: 120, workdir: "~/.choose-you/workspace" },
      "/home/vscode/.local/bin/claude",
      { nodePath: "/usr/bin/node", interpreter: "node" },
    );
    expect(out.script).toContain("cd ~/.choose-you/workspace || exit 1");
  });

  it("job.env 注入段在 PATH 兜底之后；workdir cd 与 exec 收口保持原位", () => {
    const out = remoteDispatchScript(
      {
        command: "claude",
        args: "-p {prompt}",
        prompt: "p",
        timeoutSecs: 120,
        workdir: "/srv/app",
        env: { PK_DISPATCH_TASK: "4" },
      },
      "/home/vscode/.local/bin/claude",
      { nodePath: "/usr/bin/node", interpreter: "node" },
    );
    const lines = out.script.split("; ");
    const pathIdx = lines.findIndex((l) => l.startsWith("export PATH="));
    const envIdx = lines.findIndex((l) => l === "export PK_DISPATCH_TASK=4");
    const cdIdx = lines.findIndex((l) => l.startsWith("cd "));
    expect(pathIdx).toBe(0);
    expect(envIdx).toBeGreaterThan(pathIdx);
    expect(cdIdx).toBeGreaterThan(envIdx);
    expect(out.script).toContain("exec /usr/bin/node");
  });
});

describe("remoteDispatchScript · direct 解释形态", () => {
  it("direct：exec 不带 node 前缀（原生二进制 CLI 直执行）", () => {
    const out = remoteDispatchScript(
      { command: "claude", args: "-p {prompt}", prompt: "p", timeoutSecs: 120, workdir: null },
      "/home/vscode/.local/bin/claude",
      { nodePath: "/usr/bin/node", interpreter: "direct" },
    );
    expect(out.script).toContain("exec /home/vscode/.local/bin/claude -p p");
    expect(out.script).not.toContain("/usr/bin/node");
  });
});

describe("classifyRemoteCliHead · CLI 解释形态分类", () => {
  it("ELF 原生二进制 → direct（回归：claude-code ≥2.x npm bin/claude.exe，node 直载 ERR_UNKNOWN_FILE_EXTENSION）", () => {
    expect(classifyRemoteCliHead("\u007fELF\u0002\u0001\u0001\u0000")).toBe("direct");
  });

  it("node shebang → node（env 形态与绝对路径形态；nodejs 同族）", () => {
    expect(classifyRemoteCliHead("#!/usr/bin/env node\n")).toBe("node");
    expect(classifyRemoteCliHead("#!/usr/local/bin/node\nprocess.exit(0);")).toBe("node");
    expect(classifyRemoteCliHead("#!/usr/bin/env -S node --x\n")).toBe("node");
    expect(classifyRemoteCliHead("#!/usr/bin/nodejs\n")).toBe("node");
  });

  it("其他解释器 shebang → direct；无 shebang JS → node（缺省口径）", () => {
    expect(classifyRemoteCliHead("#!/bin/sh\n")).toBe("direct");
    expect(classifyRemoteCliHead("#!/usr/bin/env python3\n")).toBe("direct");
    expect(classifyRemoteCliHead("console.log('entry');\n")).toBe("node");
  });
});
