# 无头分类工作流（pk suggest batch）

适用场景：应用以无头方式（如 `claude -p`）调起你，prompt 正文中带一批待判定消息（`[消息id]` 方括号标注）。你的任务是把判定结果**结构化写回数据库**——不要输出 JSON 文本、不要解释判定过程。

## 步骤

1. **`pk context`**：拿当前时间、未完成待办（判重依据）、可用分类与标签。
2. **逐条判定** prompt 中的消息（判定规则以 prompt 正文为准）：
   - `todo`：新的待办事项
   - `update`：消息明确修改现有待办的属性（改期/优先级/标题等），填 `updateTaskId`，只给要变的字段
   - `followUp`：现有待办的补充信息/进展/确认，不改变任务属性，填 `followUpTaskId`
   - `none`：无需行动（重复提及、闲聊、纯信息分享）
3. **一次提交整批**（建议列表经 stdin 传给 `pk suggest batch`）：

   ```bash
   pk suggest batch --agent <prompt 中给出的 agent id> <<'EOF'
   {"results":[
     {"messageId":"om_x1","action":"todo","title":"交周报","category":"工作","priority":"high","due":"2026-09-14T18:00","tags":[{"name":"重要","dimension":"topic","isNew":false},{"name":"周报系统","dimension":"project","isNew":true}],"reason":"对方明确要求周五前交付","confidence":"high"},
     {"messageId":"om_x2","action":"followUp","followUpTaskId":3,"reason":"进展确认","confidence":"medium"},
     {"messageId":"om_x3","action":"none","reason":"纯信息分享无需行动","confidence":"high"}
   ]}
   EOF
   ```

4. **检查输出**：`{"submitted":N,"todo":x,"update":y,"followUp":z,"none":w}`，条数应与 prompt 中的消息数一致。
5. 校验失败会报明**第几条、什么问题**（未知消息/待办、非法枚举、未知分类标签等）——按提示修正后**整批重试**；已处理过的消息会提示「已人工确认」，从列表剔除后重提其余即可。
6. 全部提交成功后，输出一行简短总结即可结束。

## 规则

- 所有 id 必须来自 prompt 的消息列表或 `pk context` 的 openTasks，不要猜测或编造
- 分类必须存在于 context；title 用不超过 20 字的祈使句中文
- tags 按维度选 0~3 个：词表内标签用对象 `{"name","dimension","isNew":false}`；某维度没有贴切选项且消息有明确依据（出现的项目名/人名/群名）时可提议新标签（`isNew:true`），模糊语境复用现有标签或留空；`pk context` 的 dimensions 里 remaining<=0 的维度禁止新建
- 需要变更标签时给出完整的新数组；不变的字段留空/省略
- 整批一损俱损：任何一条不合法全部不落库，修完再重提
- 远程部署时 `pk` 可能是经 SSH 透传的 shim，单次调用有网络往返——**务必用 batch 一次提交**，不要逐条 `pk suggest`
