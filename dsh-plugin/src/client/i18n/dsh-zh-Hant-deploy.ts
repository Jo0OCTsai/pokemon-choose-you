/**
 * dsh.deploy 键 · 繁體中文（从 dsh-zh-Hant.ts 拆出——棘轮 max-lines，等量迁移；
 * dsh-zh-Hant.ts 经 spread 合并，消费面不变）。
 */
export default {
  deploy: {
    title: "遠端部署",
    counts: "就緒 {ready} · 未就緒 {pending} · 斷線 {broken}",
    empty: "還沒有遠端部署。新增一台遠端機器，把 agent 派去遠方",
    add: "＋ 新增部署",
    edit: "編輯",
    remove: "移除",
    provision: "開通",
    reconnect: "重連並檢查",
    wizardRunning: "向導執行中",
    directTag: "直連模式（未經摘要校驗）",
    lastError: "最近錯誤：{summary}",
    editFallback: "已儲存。部署已回落為未就緒——路徑變更後請重跑開通向導複核",
    sshMissing: "遠端派發需要 dsh-ssh 家族，當前未裝載（裝載指引：{cmd}）",
    copyGuide: "複製裝載指引",
    status: {
      ready: "就緒",
      readyDirect: "就緒（直連）",
      notReady: "未就緒",
      disconnected: "斷線",
    },
    form: {
      addTitle: "新增部署",
      editTitle: "編輯部署",
      alias: "OpenSSH 別名（憑證由別名承載，插件不存私鑰）",
      nodePath: "遠端 Node 路徑",
      workdir: "預設遠端工作目錄",
      note: "備註",
      aliasRequired: "別名不能為空",
      pathRequired: "Node 路徑不能為空",
    },
    removeTitle: "移除部署",
    removeBody:
      "移除「{alias}」將關閉連線，並盡力觸發遠端 helper 自清理（清理失敗不阻塞，僅記錄到診斷段）。本機記錄隨之刪除。",
    removeConfirm: "確認移除",
    wizard: {
      title: "開通向導",
      concurrent: "向導正在執行中——等待完成、重開續看，或先中止",
      step: {
        "probe-ssh": "免密連線探測",
        "probe-node": "遠端 Node 探測",
        upload: "helper 上傳安裝",
        verify: "摘要校驗",
      },
      state: {
        pending: "等待",
        probing: "探測中…",
        installing: "安裝中…",
        verifying: "校驗中…",
        done: "完成",
        failed: "失敗",
        skipped: "跳過（已完成）",
      },
      fail: {
        "probe-ssh": "免密連線未通過。先在本機跑 ssh-copy-id（或把公鑰加入 ssh-agent），再回到這裡重試",
        "probe-node": "遠端 Node 探測失敗。修正路徑或安裝可用 Node（≥18）後重試",
        upload: "helper 上傳安裝失敗。可重試；或經「跳過安裝，轉直連」顯式降級（留痕）",
        verify: "遠端 helper 摘要與預期不符——拒絕置為就緒。可重新安裝，或經下方入口顯式轉直連（留痕）",
      },
      retry: "重試此步",
      abort: "中止（部署停當前態，可冪等續跑）",
      skipInstallEntry: "跳過安裝，轉直連…",
      mismatchEntry: "轉直連",
      logTitle: "向導輸出",
      logEmpty: "（等待執行輸出…）",
      closeHint: "Esc/✕ 關閉 = 後台繼續（卡面「向導執行中」徽章反映）",
    },
    degrade: {
      title: "轉為直連確認",
      body: "轉為直連後，該部署的派發不再經過 helper 摘要校驗，安全性下降。此選擇會留痕到診斷段。",
      confirm: "確認轉直連",
    },
  },
} as const;
