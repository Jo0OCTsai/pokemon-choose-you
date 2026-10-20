# judge/ —— 判定编排（AD §3.1）

批次组装（30 分钟同会话上下文、@提及标注）、判定 claim（§5.4，迟到落库封闭 A22）、执行方适配器
（dsh 内置通道 / 外部 agent CLI，A7；会话 id 三源 = 信封回填 > dsh `--json` 事件流捕获 > claude/pi
预生成，失败路径经 `withSessionId` 回链账本）、结构化提交强校验（提交期/接受期两集，§4.2）、落库还原；
重试自限 ≤2 次（A21）；selfLanding 失败挽救后 30s 迟到回看（judge.rs 同构：孤儿 pk suggest 翻正即
onWrites 通知 UI，回看不写库）（并行组 4）。
