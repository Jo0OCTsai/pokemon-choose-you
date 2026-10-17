/**
 * 平台中立 SSH 作用域接口（AD §3.2 / §4.7）：remote/ 全部远端操作的唯一出口面。
 * 本目录零 dsh import——真实实现归 src/host/dsh/sshScope.ts（per-deployment isolate
 * + dsh-ssh 家族动态装载，任务 2.1 按本接口对齐）；remote/ 与测试只面向本接口。
 *
 * 连接生命周期约定（实现侧契约）：
 * - scope 由部署实体组装（alias / nodePath / helperPath / workdir），按部署缓存复用；
 * - connected = false 表示传输层已断开（断开事件回调由实现侧置位）；
 * - disconnect() 幂等（重复调用无副作用）。
 */

/** spawn 选项 */
export interface SshSpawnOptions {
  /** 整体超时（ms；缺省按实现侧全局缺省） */
  timeoutMs?: number;
  /** stdin 管道灌入（writeFile 上传原语消费——字节安全、零命令行拼接） */
  stdin?: Buffer | string;
}

/** spawn 结果（退出码 / 输出 / 时长） */
export interface SshSpawnResult {
  /** 退出码（被杀/拿不到 = null） */
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** 真 PTY 终端会话参数（远端起进程，本机 dsh 终端面板呈现） */
export interface SshTerminalOptions {
  command: string;
  args?: string[];
  cwd?: string;
}

/** 远端文件写入结果（写毕远端 sha256 复核——上传完整性内建保障） */
export interface SshWriteResult {
  /** 远端实际落盘内容的 SHA-256（hex 小写） */
  sha256: string;
}

/**
 * SSH 作用域：一台远端机器的连接 + 进程/文件操作面。
 * 全部方法失败语义 = 抛错（执行失败/断连）或非零退出码；调用方（remote/ 各模块）
 * 负责把失败映射为机器稳定的步骤错误 tag。
 */
export interface SshScope {
  /** 连接是否存活（断开事件后置 false，直到重建） */
  readonly connected: boolean;

  /** 无终端执行一条命令（argv 形态；stdin 管道用于文件上传） */
  spawn(cmd: string[], opts?: SshSpawnOptions): Promise<SshSpawnResult>;

  /** 远端真 PTY 会话（dsh 终端面板呈现；返回会话标识） */
  spawnTerminal(opts: SshTerminalOptions): Promise<{ sessionId: string }>;

  /** 远端 shell 快捷命令（组装方保证逐参 posixQuote——NFR-11④） */
  shell(cmd: string): Promise<{ code: number; stdout: string; stderr: string }>;

  /**
   * 远端文件写入：spawn `cat > path` + stdin 管道灌内容（字节安全、零命令行拼接），
   * 写毕远端 sha256 复核并返回（AD §4.5 步③上传原语）。
   */
  writeFile(path: string, content: Buffer | string): Promise<SshWriteResult>;

  /** 关闭连接（幂等；部署移除/断连收口消费） */
  disconnect(): Promise<void>;
}
