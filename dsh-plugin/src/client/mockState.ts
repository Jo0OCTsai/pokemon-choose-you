/**
 * mockHost 默认内存态工厂（从 mockHost.ts 拆出——棘轮 max-lines，等量迁移）：
 * 健康绿灯 + helper 能力位全 true + 空库读写态；快捷键已注册、SSH 家族就绪——
 * 既有组件测试不受横幅/降级面影响，夹具按需覆盖。
 */
import type { MockHostState } from "./mockHost";

/** 缺省健康态（绿灯） */
function defaultHealth(): MockHostState["health"] {
  return {
    level: "ok",
    lastSuccessAt: "2026-10-11T08:00:00+08:00",
    nextPollAt: "2026-10-11T08:02:00+08:00",
    consecutiveFailures: 0,
    pendingCount: 0,
  };
}

/** full-parity 缺省 helper 能力位（全 true）——既有组件测试不受横幅/降级面影响；夹具按需覆盖 */
function defaultHelperCaps(): MockHostState["helperCaps"] {
  const keys = "sys-tray sys-shortcut sys-notify sys-tts sys-dialog sys-open input-count mac-auth".split(" ");
  return Object.fromEntries(keys.map((key) => [key, true]));
}

/** 默认内存态（空库 + 健康绿灯 + 读写库；快捷键已注册、SSH 家族就绪——同上缺省口径） */
export function defaultState(): MockHostState {
  return {
    tasks: [],
    categories: [],
    messages: [],
    settings: {},
    agents: [],
    health: defaultHealth(),
    dbStatus: { userVersion: 1, pluginWindow: { min: 1, max: 1 }, mode: "ok" },
    larkAuthorized: true,
    filters: [],
    logEntries: [],
    diagnostics: [],
    promptSpecs: [],
    deleted: [],
    sessions: [],
    followups: {},
    taskLogs: {},
    backups: [],
    tags: [],
    dimensions: [],
    tagCheckup: { merges: [], zombies: [], newDimensions: [], judged: false },
    pkSkill: { installedVersion: null, checked: false },
    petRunning: true,
    pomodoro: null,
    deployments: [],
    tunnelStates: {},
    sshAliases: [],
    provisionFail: null,
    pkSetupFail: null,
    recheckRecovers: false,
    sessionRows: [],
    dispatchHandoff: {},
    importFiles: [],
    importResult: { backupId: "pokemon-choose-you-20261017-090000.db", applied: 12 },
    restoreOutcome: null,
    exportDir: { path: "/mock/.choose-you/data/exports" },
    macAuth: {
      granted: false,
      helperPath: "/mock/.dsh/electron/dist/pky-helper.app/Contents/MacOS/pky-helper",
    },
    helperCaps: defaultHelperCaps(),
    shortcutRegistered: true,
    sshFamily: { ok: true },
    helperVersion: null,
  };
}
