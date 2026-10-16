/**
 * dsh.* 增量键 · 繁體中文（按主應用繁中字典同構轉換——桌寵/圖鑑機/草叢/溜走/調頻等術語對齊）。
 */
export default {
  page: {
    title: "圖鑑機",
    pending: "待處理 {n}",
  },
  empty: {
    tasks: "草叢靜悄悄——在會話裡說一句，或用 ⚡發報，第一隻野生寶可夢就會出現",
    radio: "電波安靜。有新訊息會以計數提醒，不會打擾你",
    dispatch: "還沒有派出過 agent",
  },
  auth: {
    unauthorized: "收音機還沒調頻——授權飛書後開始接收電波",
    expired: "飛書授權已失效，輪詢已暫停",
  },
  schema: {
    tooNew: "圖鑑機遇到了點狀況：待辦庫版本較新，需升級插件後才能寫入。瀏覽不受影響。",
    readonly: "唯讀模式",
  },
  toast: {
    alreadyHandled: "這條建議已在另一處處置過了",
    caught: "已捕捉「{title}」",
    caughtMatch: "產生了更新建議，待你確認",
    released: "已放生「{title}」",
    undo: "撤銷 {sec}s",
    dispatchBusy: "該任務已有進行中的派發，請先收口或重置",
    savedHint: "已保存",
  },
  release: {
    confirmBody: "放生後「{title}」將連同標籤關聯與跟進記錄一併刪除，操作記錄存檔。執行後 5 秒內可撤銷。",
    confirmOk: "確認放生",
  },
  batch: {
    selected: "已選 {n} 條",
    catchAll: "◎ 全部捕捉",
    releaseAll: "✕ 全部逃走（統一原因碼）",
    clear: "清除",
  },
  failed: {
    group: "AI 判定失敗 · {n} 條",
    retryAll: "一鍵重判",
    forceCapture: "強制捕捉",
    forceDismiss: "強制逃走",
  },
  overdue: {
    leaked: "昨天有 {n} 隻溜走了",
    expand: "展開",
  },
  radio: {
    stateWarn: "重試中",
    stateFail: "未授權",
    failCount: "連續失敗 {n}",
    kbdHint:
      "J/K 上下條 · C 捕捉 · X 逃走 · U 應用更新 · R 恢復（逃走留檔項） · T 接受新標籤提議 · Esc 收起（僅插件頁面聚焦域內生效，不註冊全域快捷鍵）",
    acceptTag: "＋ 接受新標籤提議",
    judging: "判定中…",
  },
  dispatch: {
    tooltipQueued: "排隊中，等待執行",
    tooltipRunning: "agent 執行中",
    tooltipDone: "已回傳，查看時間線",
    tooltipFailed: "執行失敗：{reason}",
    badge: {
      queued: "排隊中",
      running: "派發執行中",
      done: "已回傳",
      failed: "失敗",
    },
    confirm:
      "即將派發：{agent} · {scope} · {dir} · 來源：{project}。可臨時改選，不回寫專案路由。互動通道將在終端機面板啟動，可隨時觀察接管。",
    scopeLocal: "本機",
    scopeRemote: "遠端",
    sourceRoute: "專案路由",
    sourceDefault: "全域預設",
    redo: "重派",
    cancelQueued: "取消排隊",
  },
  agents: {
    commandRequired: "agent 命令不能為空（填可執行檔名或絕對路徑）",
    argsPh: "-p {prompt}",
    sshHostPh: "user@host",
    presetLabel: "Agent 預設",
    presetCustom: "自訂",
  },
  pet: {
    showNotReady: "桌寵未在 5 秒內完成啟動握手，可能仍在啟動中",
    clearMain: "清除",
  },
  tag: {
    deleteConfirm: "刪除標籤「{name}」？其與待辦的關聯將一併清理。",
  },
  task: {
    reschedule: "改期",
  },
  chip: {
    openPage: "開啟圖鑑機頁面",
    resting: "休息中",
  },
  settings: {
    saving: "保存中…",
    saved: "已保存",
    saveFailed: "保存失敗：{reason}——草稿已保留，可重試",
    unsavedTitle: "有未保存的修改",
    leaveTitle: "背包還有未保存的修改。",
    leaveSave: "保存並離開",
    leaveDiscard: "放棄修改",
    leaveStay: "留在這裡",
    judgeSource: "當前：消費主應用結果（dsh 側不自行判定）",
    dbStatusTitle: "待辦庫狀態",
    dbStatusQuery: "查詢庫狀態",
    dbUserVersion: "庫版本 v{v} · {mode}",
    dbModeRw: "讀寫正常",
    dbModeRo: "唯讀（需升級插件）",
    guideTitle: "使用指南",
    guideLink: "docs/USER_GUIDE.md · dsh 形態章節 ↗",
  },
  badge: {
    mainApp: "作用於主應用",
    notifications: "作用於主應用觸達",
    pet: "作用於主應用桌寵",
    dispatch: "作用於主應用互動派發",
  },
  pokeSearch: {
    placeholder: "搜尋寶可夢（1025 隻 · 名稱 / 編號 / 英文名）",
    searching: "搜尋中…",
    noResult: "沒有找到這隻寶可夢，換個編號或名字試試",
    bundled: "內建",
  },
  category: {
    releaseConfirm: "放生分類「{name}」後，其 {n} 個任務將歸入第一個分類「{first}」，標籤維度與標籤保留。",
  },
  filter: {
    p2pLocked: "私聊固定跟隨，不參與過濾",
  },
  prompts: {
    conflictRefreshed: "提示詞已在另一形態更新，已為你刷新到最新版",
    forceOverwrite: "已在另一處被修改——確認覆蓋？",
  },
} as const;
