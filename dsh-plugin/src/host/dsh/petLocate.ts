/**
 * 桌宠 helper 拉起面定位件（自 hostEntry 拆出控行数棘轮；找不到 = 降级停用不报错 A20）。
 * 纯探测函数零 ctx 依赖：helper 主产物向上定位 + electron 真实二进制候选链。
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { electronSpawner, type HelperSpawner } from "../pet/supervisor";

/**
 * 定位桌宠 spawner：helper 主产物（helper/dist/main.js）+ electron **真实二进制**。 探测链（注释即探测顺序单源）： helper 主产物：从本模块目录逐级向上（仓内 dev：src/host/dsh → 包根；构建产物：dist → 包根； profile 安装：node_modules/dsh-plugin/dist → 包根——file: 安装带 helper/ 才有） electron：node_modules/electron/dist/ 下的平台二进制（helper 子包 devDep → 插件包根 → 仓库根，跟随 symlink 可达 pnpm store 真实位） → ~/.dsh/electron/（dsh-pet 先例的运行时下载位：electron / bin/electron / dist/Electron.app/C
 */
export function detectPetSpawner(): HelperSpawner | undefined {
  const helperMain = locateHelperMain();
  if (helperMain === undefined) {
    return undefined;
  }
  const helperDir = dirname(helperMain);
  const electronBin = locateElectronBinary(helperDir);
  if (electronBin === undefined) {
    return undefined;
  }
  return electronSpawner(electronBin, helperMain);
}

/** 向上探测 helper/dist/main.js（上限 5 级；命中即返回绝对路径） */
export function locateHelperMain(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "helper", "dist", "main.js");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/** electron 平台二进制相对 dist 位：darwin = Electron.app 包内执行档；win32 = electron.exe；
 * 其余 = 平铺 electron（electronGet 落位产物同名——落位即被探测，full-parity AD §3.4） */
function electronDistBin(): string {
  if (process.platform === "darwin") return join("Electron.app", "Contents", "MacOS", "Electron");
  return process.platform === "win32" ? "electron.exe" : "electron";
}

/** electron 二进制候选定位（真实二进制，顺序见 detectPetSpawner 注释；全部 miss = undefined） */
function locateElectronBinary(helperDir: string): string | undefined {
  const pluginRoot = dirname(helperDir);
  const home = homedir();
  const distBin = electronDistBin();
  const candidates = [
    join(helperDir, "node_modules", "electron", "dist", distBin),
    join(pluginRoot, "node_modules", "electron", "dist", distBin),
    join(pluginRoot, "..", "node_modules", "electron", "dist", distBin),
    join(home, ".dsh", "electron", "electron"),
    join(home, ".dsh", "electron", "bin", "electron"),
    join(home, ".dsh", "electron", "dist", distBin),
  ];
  return candidates.find((candidate) => isRegularFile(candidate));
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
