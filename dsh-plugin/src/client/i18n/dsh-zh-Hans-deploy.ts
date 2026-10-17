/**
 * dsh.deploy 键 · 简体中文（从 dsh-zh-Hans.ts 拆出——棘轮 max-lines，等量迁移；
 * dsh-zh-Hans.ts 经 spread 合并，消费面不变）。
 */
export default {
  deploy: {
    title: "远程部署",
    counts: "就绪 {ready} · 未就绪 {pending} · 断开 {broken}",
    empty: "还没有远程部署。添加一台远端机器，把 agent 派去远方",
    add: "＋ 添加部署",
    edit: "编辑",
    remove: "移除",
    provision: "开通",
    reconnect: "重连并检查",
    wizardRunning: "向导执行中",
    directTag: "直连模式（未经摘要校验）",
    lastError: "最近错误：{summary}",
    editFallback: "已保存。部署已回落为未就绪——路径变更后请重跑开通向导复核",
    sshMissing: "远程派发需要 dsh-ssh 家族，当前未装载（装载指引：{cmd}）",
    copyGuide: "复制装载指引",
    status: {
      ready: "就绪",
      readyDirect: "就绪（直连）",
      notReady: "未就绪",
      disconnected: "断开",
    },
    form: {
      addTitle: "添加部署",
      editTitle: "编辑部署",
      alias: "OpenSSH 别名（凭据由别名承载，插件不存私钥）",
      nodePath: "远端 Node 路径",
      workdir: "默认远端工作目录",
      note: "备注",
      aliasRequired: "别名不能为空",
      pathRequired: "Node 路径不能为空",
    },
    removeTitle: "移除部署",
    removeBody:
      "移除「{alias}」将关闭连接，并尽力触发远端 helper 自清理（清理失败不阻塞，仅记录到诊断段）。本机记录随之删除。",
    removeConfirm: "确认移除",
    wizard: {
      title: "开通向导",
      concurrent: "向导正在执行中——等待完成、重开续看，或先中止",
      step: {
        "probe-ssh": "免密连接探测",
        "probe-node": "远端 Node 探测",
        upload: "helper 上传安装",
        verify: "摘要校验",
      },
      state: {
        pending: "等待",
        probing: "探测中…",
        installing: "安装中…",
        verifying: "校验中…",
        done: "完成",
        failed: "失败",
        skipped: "跳过（已完成）",
      },
      fail: {
        "probe-ssh": "免密连接未通过。先在本机跑 ssh-copy-id（或把公钥加入 ssh-agent），再回到这里重试",
        "probe-node": "远端 Node 探测失败。修正路径或安装可用 Node（≥18）后重试",
        upload: "helper 上传安装失败。可重试；或经「跳过安装，转直连」显式降级（留痕）",
        verify: "远端 helper 摘要与预期不符——拒绝置为就绪。可重新安装，或经下方入口显式转直连（留痕）",
      },
      retry: "重试此步",
      abort: "中止（部署停当前态，可幂等续跑）",
      skipInstallEntry: "跳过安装，转直连…",
      mismatchEntry: "转直连",
      logTitle: "向导输出",
      logEmpty: "（等待执行输出…）",
      closeHint: "Esc/✕ 关闭 = 后台继续（卡面「向导执行中」徽章反映）",
    },
    degrade: {
      title: "转为直连确认",
      body: "转为直连后，该部署的派发不再经过 helper 摘要校验，安全性下降。此选择会留痕到诊断段。",
      confirm: "确认转直连",
    },
  },
} as const;
