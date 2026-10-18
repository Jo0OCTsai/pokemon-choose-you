/**
 * remote/sshConfig：~/.ssh/config 的 Host 别名解析（部署表单下拉数据源）——
 * 大小写不敏感关键字 / 行多模式 / 通配与否定模式剔除 / 去重保序 / 注释与空行忽略 /
 * 文件缺席或不可读 = 空列表（表单呈现空态提示，不报错）。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSshHostAliases, readSshConfigAliases } from "../../src/host/remote/sshConfig";

describe("parseSshHostAliases（纯函数）", () => {
  it("提取 Host 行别名：大小写不敏感 + 行多模式 + 保序去重", () => {
    const text = [
      "Host gpu-1 gpu-2",
      "  HostName 10.0.0.1",
      "host lab-box",
      "  User dev",
      "Host gpu-1",
      "# Host commented-out",
      "",
      "Port 22",
    ].join("\n");
    expect(parseSshHostAliases(text)).toEqual(["gpu-1", "gpu-2", "lab-box"]);
  });

  it("剔除通配 / 否定 / 带引号模式（非确定目标不可选；同行确定性别名保留）", () => {
    const text = ["Host *", "Host box-a box-*", "Host !negated real-1", 'Host "quoted-name" real-2'].join("\n");
    expect(parseSshHostAliases(text)).toEqual(["box-a", "real-1", "real-2"]);
  });

  it("整行注释忽略；参数中的 # 不当注释剥（OpenSSH 口径：仅行首 # 是注释）", () => {
    const text = ["# Host gone", "Host kept-1"].join("\n");
    expect(parseSshHostAliases(text)).toEqual(["kept-1"]);
  });

  it("空文本与无 Host 行 → 空列表", () => {
    expect(parseSshHostAliases("")).toEqual([]);
    expect(parseSshHostAliases("HostName 10.0.0.1\nUser dev\n")).toEqual([]);
  });
});

describe("readSshConfigAliases（读侧）", () => {
  it("读 <home>/.ssh/config 并解析；缺目录 / 缺文件 / 非 Host 行 → 空列表不抛", () => {
    const home = mkdtempSync(join(tmpdir(), "pky-ssh-cfg-"));
    // 缺 .ssh 目录
    expect(readSshConfigAliases(home)).toEqual([]);
    mkdirSync(join(home, ".ssh"));
    // 缺 config 文件
    expect(readSshConfigAliases(home)).toEqual([]);
    writeFileSync(join(home, ".ssh", "config"), "Host gpu-1\n  HostName 10.0.0.1\nHost *\n", "utf8");
    expect(readSshConfigAliases(home)).toEqual(["gpu-1"]);
    // 非 Host 行内容
    writeFileSync(join(home, ".ssh", "config"), "HostName 10.0.0.1\n", "utf8");
    expect(readSshConfigAliases(home)).toEqual([]);
  });
});
