/**
 * dsh.* 增量键 · 简体中文（源文案，uiux-design.md §8 全表）。与主应用共享语义的键
 * 复用主应用字典（经 @app-i18n 直引，装配见 index.ts），此处只放 dsh 形态专属键。
 */
export default {
  page: {
    title: "图鉴机",
    pending: "待处理 {n}",
  },
  empty: {
    tasks: "草丛静悄悄——在会话里说一句，或用 ⚡发报，第一只野生宝可梦就会出现",
    radio: "电波安静。有新消息会以计数提醒，不会打扰你",
    dispatch: "还没有派出过 agent",
  },
  auth: {
    unauthorized: "收音机还没调频——授权飞书后开始接收电波",
    expired: "飞书授权已失效，轮询已暂停",
  },
  schema: {
    tooNew: "图鉴机遇到了点状况：待办库版本较新，需升级插件后才能写入。浏览不受影响。",
    readonly: "只读模式",
  },
  toast: {
    alreadyHandled: "这条建议已在另一处处置过了",
    caught: "已捕捉「{title}」",
    caughtMatch: "产生了更新建议，待你确认",
    released: "已放生「{title}」",
    undo: "撤销 {sec}s",
    dispatchBusy: "该任务已有进行中的派发，请先收口或重置",
    savedHint: "已保存",
  },
  release: {
    confirmBody: "放生后「{title}」将连同标签关联与跟进记录一并删除，操作记录留档。执行后 5 秒内可撤销。",
    confirmOk: "确认放生",
  },
  batch: {
    selected: "已选 {n} 条",
    catchAll: "◎ 全部捕捉",
    releaseAll: "✕ 全部逃走（统一原因码）",
    clear: "清除",
  },
  failed: {
    retryAll: "一键重判",
    forceCapture: "强制捕捉",
    forceDismiss: "强制逃走",
  },
  overdue: {
    leaked: "昨天有 {n} 只溜走了",
    expand: "展开",
  },
  radio: {
    stateWarn: "重试中",
    stateFail: "未授权",
    failCount: "连续失败 {n}",
    kbdHint: "快捷键：J/K 上下条 · C 捕捉 · X 逃走 · U 应用更新 · R 恢复（逃走留档项） · T 接受新标签提议 · Esc 收起",
    acceptTag: "＋ 接受新标签提议",
    judging: "判定中…",
  },
  dispatch: {
    tooltipQueued: "排队中，等待执行",
    tooltipRunning: "agent 执行中",
    tooltipDone: "已回传，查看时间线",
    tooltipFailed: "执行失败：{reason}",
    badge: {
      queued: "排队中",
      running: "派发执行中",
      done: "已回传",
      failed: "失败",
    },
    confirm:
      "即将派发：{agent} · {scope} · {dir} · 来源：{project}。可临时改选，不回写项目路由。交互通道将在终端面板启动，可随时观察接管。",
    scopeLocal: "本机",
    scopeRemote: "远程",
    sourceRoute: "项目路由",
    sourceDefault: "全局默认",
    redo: "重派",
    cancelQueued: "取消排队",
  },
  agents: {
    commandRequired: "agent 命令不能为空（填可执行文件名或绝对路径）",
    argsPh: "-p {prompt}",
    sshHostPh: "user@host",
    presetLabel: "Agent 预设",
    presetCustom: "自定义",
  },
  pet: {
    showNotReady: "桌宠未在 5 秒内完成启动握手，可能仍在启动中",
    clearMain: "清除",
    showRow: "显示桌宠",
    show: "显示",
    hide: "隐藏",
    stateLabel: "当前状态：",
    stateShown: "显示中",
    stateHidden: "已隐藏",
    stateUnknown: "未知",
  },
  tag: {
    deleteConfirm: "删除标签「{name}」？其与待办的关联将一并清理。",
  },
  task: {
    reschedule: "改期",
  },
  dt: {
    hour: "时",
    minute: "分",
    period: "上下午",
    prevMonth: "上月",
    nextMonth: "下月",
  },
  chip: {
    openPage: "打开图鉴机页面",
    resting: "休息中",
  },
  settings: {
    saving: "保存中…",
    saved: "已保存",
    saveFailed: "保存失败：{reason}——草稿已保留，可重试",
    unsavedTitle: "有未保存的修改",
    leaveTitle: "背包还有未保存的修改。",
    leaveSave: "保存并离开",
    leaveDiscard: "放弃修改",
    leaveStay: "留在这里",
    judgeSource: "当前：消费主应用结果（dsh 侧不自行判定）",
    dbStatusTitle: "待办库状态",
    dbStatusQuery: "查询库状态",
    dbUserVersion: "库版本 v{v} · {mode}",
    dbModeRw: "读写正常",
    dbModeRo: "只读（需升级插件）",
    guideTitle: "使用指南",
    guideLink: "docs/USER_GUIDE.md · dsh 形态章节 ↗",
  },
  badge: {
    mainApp: "作用于主应用",
    notifications: "作用于主应用触达",
    pet: "作用于主应用桌宠",
    dispatch: "作用于主应用交互派发",
  },
  pokeSearch: {
    placeholder: "搜索宝可梦（1025 只 · 名称 / 编号 / 英文名）",
    searching: "搜索中…",
    noResult: "没有找到这只宝可梦，换个编号或名字试试",
    bundled: "内置",
  },
  category: {
    releaseConfirm: "放生分类「{name}」后，其 {n} 个任务将归入第一个分类「{first}」，标签维度与标签保留。",
  },
  filter: {
    p2pLocked: "私聊固定跟随，不参与过滤",
  },
  prompts: {
    conflictRefreshed: "提示词已在另一形态更新，已为你刷新为最新版",
    forceOverwrite: "已在另一处被修改——确认覆盖？",
    forceOverwriteConfirm: "仍要覆盖",
  },
} as const;
