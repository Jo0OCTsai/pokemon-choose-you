/**
 * remote/sshConfig：~/.ssh/config 的 Host 别名解析（部署表单下拉数据源）——
 * 大小写不敏感关键字 / 行多模式 / 通配与否定模式剔除 / 去重保序 / 注释与空行忽略 /
 * 文件缺席或不可读 = 空列表（表单呈现空态提示，不报错）；读侧展开 Include（glob 词典序 /
 * `~` 与相对 ~/.ssh 路径 / 引号 / 嵌套上限 16 / 环不重入 / 目标缺席或不可读跳过）。
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

  it("纯文本解析不展开 Include（无文件上下文，Include 行按普通指令跳过）", () => {
    expect(parseSshHostAliases("Include conf.d/*\nHost only-inline")).toEqual(["only-inline"]);
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

/** Include 用例的临时 home（带 .ssh/conf.d）+ 相对 .ssh 的写文件助手 */
function sshHome(): { home: string; write: (rel: string, lines: string[]) => void } {
  const home = mkdtempSync(join(tmpdir(), "pky-ssh-inc-"));
  mkdirSync(join(home, ".ssh", "conf.d"), { recursive: true });
  return {
    home,
    write: (rel, lines) => writeFileSync(join(home, ".ssh", rel), `${lines.join("\n")}\n`, "utf8"),
  };
}

describe("readSshConfigAliases · Include 路径解析", () => {
  it("相对 glob 挂 ~/.ssh 展开：词典序 + 原位插入（config 序 = ssh 优先序）", () => {
    const { home, write } = sshHome();
    write("config", ["Host main", "Include conf.d/*.conf", "Host tail"]);
    write("conf.d/b.conf", ["Host from-b"]);
    write("conf.d/a.conf", ["Host from-a", "Host *"]);
    write("conf.d/ignored.txt", ["Host not-matched"]);
    expect(readSshConfigAliases(home)).toEqual(["main", "from-a", "from-b", "tail"]);
  });

  it("关键字大小写不敏感 + 一行多路径 + 引号路径 + `~/` 与绝对路径", () => {
    const { home, write } = sshHome();
    mkdirSync(join(home, "elsewhere"));
    writeFileSync(join(home, "elsewhere", "extra-b"), "Host eb\n", "utf8");
    write("extra-a", ["Host ea"]);
    write("config", [`include "~/.ssh/extra-a" ${join(home, "elsewhere", "extra-b")}`]);
    expect(readSshConfigAliases(home)).toEqual(["ea", "eb"]);
  });

  it("目标缺席 / glob 零命中 / 命中目录 → 跳过不抛，其余别名照常", () => {
    const { home, write } = sshHome();
    write("config", ["Host keep", "Include missing-file", "Include nothing-*.conf", "Include conf.d", "Host keep-2"]);
    expect(readSshConfigAliases(home)).toEqual(["keep", "keep-2"]);
  });
});

describe("readSshConfigAliases · Include 递归守卫", () => {
  it("环（互包含 / 回包含主 config）不重入不死循环，别名去重", () => {
    const { home, write } = sshHome();
    write("config", ["Include loop-a", "Host root"]);
    write("loop-a", ["Host la", "Include loop-b"]);
    write("loop-b", ["Host lb", "Include loop-a", "Include config", "Host la"]);
    expect(readSshConfigAliases(home)).toEqual(["la", "lb", "root"]);
  });

  it("嵌套上限 16（主 config 为第 0 层）：第 17 层静默跳过", () => {
    const { home, write } = sshHome();
    write("config", ["Host h0", "Include chain-1"]);
    for (let n = 1; n <= 18; n++) {
      write(`chain-${n}`, [`Host h${n}`, `Include chain-${n + 1}`]);
    }
    const expected = Array.from({ length: 17 }, (_, i) => `h${i}`);
    expect(readSshConfigAliases(home)).toEqual(expected);
  });
});
