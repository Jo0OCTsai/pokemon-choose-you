/**
 * agent 工具面测试共享件：直插一个 agent 配置（ai_agents 设置键，loadAgents 口径；
 * remote 可选 = 远端 SSH 执行；skillDir 可选 = 技能根目录覆盖值）。
 * agent-tools.spec 与 agent-tools-skills.spec 共用（棘轮 max-lines 拆件）。
 */
import type { Conn } from "../src/host/storage/db";

export function seedAgent(
  conn: Conn,
  id: string,
  command: string,
  deployment?: string,
  workdir = "",
  skillDir?: string,
): void {
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_agents', ?)").run(
    JSON.stringify([
      {
        id,
        name: id,
        command,
        args: "",
        historyArgs: "",
        workdir,
        timeoutSecs: 30,
        enabled: true,
        ...(deployment !== undefined ? { deployment } : {}),
        ...(skillDir !== undefined ? { skillDir } : {}),
      },
    ]),
  );
}
