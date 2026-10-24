# dsh-plugin 面板样式设计稿 ——「副屏」渗透体系

> 规模分级：M（单模块样式刷新，无新实体、无架构变更；跳 AD）。
> 上位文档：`specs/dsh-plugin/uiux-design.md` §6（双轨策略：宿主为体、世界观为魂）——本稿是该策略
> **面板侧的落法细化**：§6.1 明确警告过两个极端，当前实现落在了极端②「宿主默认灰白列表零世界观」
> （等于没设计）。本稿把「中间路线」从口号落成可实施的档位、token 与组件清单。
> 配套可视原型：`specs/dsh-plugin-style/uiux-prototype.html`（亮暗双态、逐组件目标样式）。
>
> **⚠️ 与上位文档的约束变更声明（须随本稿一并过 review）**：上位 §6.1 原文「世界观收窄为三个可带走
> 的 signature 载体」「**绝不把 Tauri 图鉴机的机身红/LCD 硬阴影贴进 React 宿主**」、§6.2「阴影一律取
> 宿主档位」。本稿以「副屏」隐喻对其作**实质性修订**（不是细化）：机身边界语言（机身红铺底、外壳
> 粗描边、像素丝印字体）维持禁入；「屏幕显示语言」（LCD 阅读面、≤2px 硬阴影一档、墨线、黄选中）
> 重新划为可进宿主——依据：这些是图鉴机**屏幕上显示的内容**而非机壳，且全部以 `--pcy-*` scoped
> token + 宿主骨架档位（圆角/间距/字号）落地。本稿通过 review 后须在上位 §6.1/§6.2 增补修订指针，
> 避免后续按旧口径验收判违规。

## 1. 问题理解

**现状为什么素**：组件结构已与桌面 app 对齐，但视觉词汇几乎全是宿主中性面——

| 维度 | 桌面 app（图鉴机） | dsh-plugin 现状 |
|---|---|---|
| 线 | 藏青墨线 2–4px，档位分明 | 全部 1px 灰 `border-l1/l2`，无墨感 |
| 选中 | 黄底 + 墨线 + ▶ 光标 | 宿主蓝底白字（导航）/ 灰底（列表行） |
| 阅读面 | LCD 绿屏 + 扫描线（收音机全文/日志） | 白底灰框 |
| 完成 | LCD 化（绿屏 + 内阴影 + 灰度精灵） | 仅删除线 + 灰度 |
| 深度 | 硬阴影 2–4px（机壳按压感） | 仅弹窗软阴影 |
| 强调 | 皮卡丘黄按钮 + 墨线 | 宿主蓝按钮 |

世界观只剩 `--pcy-*` 小色点（徽章/置信/优先级/派发）在撑，远达不到 §6.1 要求的「一眼认出这是图鉴机」。

**目标**：面板具备图鉴机的可识别风格（黄选中、墨线、LCD、硬阴影、等宽编号），同时保持 dsh 宿主内的和谐——控件熟悉度不破坏、亮暗主题不翻车、a11y 底线不回退。

**非目标**：不改任何交互逻辑/信息架构/文案；不新增动画；不加载像素字体（U6 不变）。

## 2. 设计概念：「副屏」

**桌面 app 是图鉴机的机身，插件面板是这台机器投到 dsh 里的那块「副屏」。**

机身语言（机脊红、外壳圆角、像素丝印、物理按键的按压结构）留在桌面 app；传进宿主的是这块
**屏幕的显示语言**：墨线描边、黄色选中光标、LCD 阅读面、等宽图鉴编号。宿主的窗口、控件、字体
就是「别人的显示器」——显示器归宿主，屏幕上显示什么归图鉴机。

由这个隐喻直接导出**渗透三档**（判据：这个元素在图鉴机的世界里，是「显示器的一部分」还是「屏幕内容」）：

| 档位 | 名 | 判据 | 策略 |
|---|---|---|---|
| **T0 壳** | 宿主 chrome | 显示器的一部分：输入框/下拉/开关/弹窗/抽屉壳/遮罩/焦点环/滚动条 | 100% 宿主 token，零渗透（控件熟悉度 = 宿主信任） |
| **T1 墨** | 渗透面 | 屏幕内容的容器：条目卡、列表框、分组、导航胶囊、状态条、批量托盘 | 宿主骨架（圆角/间距/字号不动）+ 图鉴机的**线与黄**：墨线边框、黄色选中、纸色点缀 |
| **T2 屏** | 签名位 | 屏幕本身的显示面：只读阅读区 | 全浓度图鉴质感：LCD 绿屏 + 扫描线 + 内阴影；**全页仅三处**（见 §5-T2） |

**大胆花在一处**：LCD 阅读面是面板唯一的浓墨签名；其余一切安静纪律（墨线只有 1–1.5px，黄只在
选中与主行动，硬阴影只有 2px 一档）。

## 3. 视觉词汇（四条语言，全部取值 DESIGN_SYSTEM 同源）

### 3.1 墨线（ink line）

- **重墨线** = `var(--dsw-alias-label-primary, #1f2328)` 的 1.5–2px 边框/分隔线：用于 T1/T2 的
  图鉴对象（进行中卡、LCD 框、捕捉分隔线、黄按钮、托盘）。**用 alias 而非固定 `#1a1b25`**
  ——label-primary 随主题翻转（亮 = 近墨、暗 = 近纸白），墨线在暗色下自动变为「暗色漫画的白描线」，
  无需新增主题机制。
- **轻墨线** = `var(--dsw-alias-border-l3, #c7cdd4)`：T1 次级容器（分组框、AI 建议盒）从 l1/l2 升到 l3，补一点墨感但不到重线。
- 禁止：3px+ **墨色**粗线（那是机身档，进宿主即异物）；既有浅灰左缘线（sshGroup/noteBlock 的 3px
  l1）不属于墨线语言，本次统一降为 2px l3 收编。
- 暗色下墨线/硬阴影随 alias 翻转为近白——「暗色漫画的白描线」是刻意的风格反转，不是 bug（见 §4 降级声明）。

### 3.2 黄（amber selection）

选中与主行动 = 皮卡丘黄；焦点环 = 宿主蓝不变（T0 纪律，a11y 一致性优先——黄底蓝环只在键盘导航瞬间同现，可接受）。

- **一等选中**（导航/过滤胶囊级——页面、分区、过滤器）：黄底 `--pcy-running #ffcb05` + 固定墨字
  `#1a1b25` + 1.5px 重墨线 + 字重 700。黄固定不翻转、墨字固定，天然双主题安全。
  **验收回流（2026-10-16，两轮）**：一等选中**全部去 `▶` 光标前缀**——第一轮七段导航与背包分区选单
  （用户裁决——tab 行选中不要左侧三角），第二轮图鉴过滤胶囊与复盘入口同步跟进；非颜色冗余改由
  aria-current/aria-pressed + 字重 + 重墨线承担。
- **一等弱（列表行选中）**：奶油黄底 `--pcy-hover` + 1.5px 重墨线，**不用** ▶ 与纯黄——列表行内
  大量 `label-secondary` 辅助文字对纯黄仅 4.2:1 不达标，弱化档是 a11y 必要而非风格让步。
- **二等选中**（控件内模式切换，如 ⏱/📡 视图互切）：奶油黄底 `--pcy-hover` + 文字色
  `var(--dsw-alias-label-primary)`（随主题翻转：亮 11:1 / 暗 9.4:1）——**不得用固定墨字**
  （`--pcy-hover` 暗档 `#3f3a1c` 对固定墨字仅 1.5:1）。
- **主行动按钮**（捕捉/保存/立即拉取/出发）：黄底墨字 + 1.5px 墨线 + `2px 2px 0` 硬阴影；按下
  `translate(1px,1px)` + 阴影收缩 1px（80ms transition；`prefers-reduced-motion` 归零）。新增
  `buttonDex` 档，替换现有 `buttonPrimary` 在这些位点的使用。
- 黄是主题安全色：固定黄底 + 固定墨字（11.3:1），亮暗主题都不需要变体。

### 3.3 LCD 屏（signature）

只读显示面 = LCD 绿屏三件套 + 静态扫描线 + 内阴影（桌面 `.lcd` 的等比降档）：

```
background: var(--pcy-lcd, #c4cfa1);
color: var(--pcy-lcd-text, #3a4a32);
border: 1.5px solid 重墨线;
border-radius: 宿主档位不变;
box-shadow: inset 2px 2px 0 var(--pcy-lcd-dark, #9caa86);
::after 扫描线（静态 repeating-linear-gradient，无 animation，NFR-6 不受限）
```

三处落位：① 收音机电波全文阅读区 ② 诊断日志屏 ③ **已完成条目卡的 LCD 化**（完成 = 抓到图鉴，
卡面变 LCD——桌面最讨喜的状态语言，搬进列表）。LCD 内固定亮色（亮暗主题一致，如暗色 IDE 里的
亮色终端块）；暗色下切换「夜屏」配对值（§4）。

### 3.4 纸（paper tint）

机身米白 `#f5f0dc` 只做**装饰性小面积**点缀：页头条底、精灵「图鉴框」底、托盘底、详情摘要格底。
禁大面积铺底（宿主亮暗跟随面不动）。暗色换深墨纸配对值（§4）。

### 3.5 字体与数字（不变 + 强化）

- 不加载像素字体（U6 铁律不动）。等宽 `ui-monospace` 承担图鉴编号（`No.xxx`）、时间、kbd、
  `POKé-DEX` 装饰字——已有的做法保留并**加字距**（编号 `letter-spacing: 1px`、装饰字 `1.5px`），
  让等宽字有「丝印感」。该词汇与上位认可的 signature 载体（`No.xxx` 等宽编号）同源，属既有词汇的
  加重，不是新增装饰层。
- 正文/标题 = 宿主字体体系，零改动。

## 4. Token 扩表（pcy 增量；值全部取自 DESIGN_SYSTEM，不新造亮色值）

沿用现行约定：默认值内联在消费点 `var(--pcy-x, 默认)`；`ui.module.css :root` 新增**暗色配对值**
声明块（亮色默认 = fallback 不必声明）。暗色配对值是唯一的新造色——桌面 app 无暗色主题可同源，
按「保色相、压亮度」派生，并在下表标注对比度核实值：

| Token | 亮色默认（= DESIGN_SYSTEM） | 暗色配对（:root media 声明） | 用途 |
|---|---|---|---|
| `--pcy-paper` | `#f5f0dc` | `#2a2b35` | 纸色点缀底（页头条/图鉴框/托盘） |
| `--pcy-paper-ink` | `#1a1b25` | `#dfe3ea`（对暗纸 ≥10:1） | 纸色面上的文字（与 paper 锁定为自洽配对，见下） |
| `--pcy-paper-dim` | `#f3efe6` | `#23242c` | 已逃走卡底（桌面逃逸态同源值） |
| `--pcy-hover` | `#fff3c4`（唯一悬停/选中黄） | `#3f3a1c` | 一等弱/二等选中、条目卡悬停（面上文字必须走 alias，见 §3.2） |
| `--pcy-lcd` | `#c4cfa1` | `#2b3327` | LCD 底 |
| `--pcy-lcd-text` | `#3a4a32` | `#cddcb4`（对暗 LCD 9.0:1） | LCD 文字 |
| `--pcy-lcd-dim` | `#4a563f`（对亮 LCD 4.7:1） | `#93a887`（对暗 LCD 5.1:1） | LCD 屏内次级文字（日志时间戳） |
| `--pcy-lcd-dark` | `#9caa86` | `#1e241c` | LCD 内阴影（非文字） |
| `--pcy-lcd-log-error` | `#d64545` | `#e58585`（对暗 LCD 5.0:1） | LCD 屏内日志错误色 |
| `--pcy-lcd-log-warn` | `#b8860b` | `#d4b05e`（对暗 LCD 6.3:1） | LCD 屏内日志警告色 |

不新增的：墨线（消费 alias label-primary/border-l3）、硬阴影色（同 alias label-primary）、黄系
（`--pcy-running`/`--pcy-conf-mid-soft` 等已有）、徽章五色/状态软底（已有）。`--pcy-lcd-dim` 与
暗色配对值是仅有的新造色（桌面 app 无暗色主题、无屏内次级文字档可同源），按「保 lcd-text 色相、
以 ≥4.5:1 为硬约束」派生。**主题错配降级声明（best-effort）**：暗色配对值挂在
`prefers-color-scheme`（OS）上，宿主主题若与 OS 背离——纸色/LCD 面因文字走**同泡配对值**
（paper+paper-ink、lcd 系）各自自洽，只损失色温和谐、不损可读；`--pcy-hover` 面上的 alias 文字在
错配瞬间对比度下降（悬停/选中为瞬时态，可接受）；黄系一等选中与墨线完全不受影响。

## 5. 组件改造清单（按档位；类名 = 现有 CSS Modules 实名）

### T0 壳——明确不动清单

`ui.module.css`：`input/select/toggle/dialog/overlay` 全部、`button/buttonPrimary`（非主行动位）、
`card`、`scopeBadge`、`skeleton*`；`tasks.module.css`：`editForm/editRow/textarea`、~~`datetime`~~（**回流（2026-10-17）：原生 datetime-local 收编为 DateTimePicker 弹层组件（零键入/半小时粒度/配置对齐），`.editDatetime` 类随之删除，样式落 `ui.module.css` dt\* 档**）、
`drawer 壳（除左缘线）`、`tagChip`、`triStateGroup`（表单控件层选中 = 宿主蓝）；`chip.module.css`
全文件（宿主 conversation header 领地，必须安静）；`mainPanel.module.css` 全文件；所有 `:focus-visible`
（宿主蓝环统一，无例外）；弹窗/抽屉软阴影。

### T1 墨——渗透改造（11 处）

| # | 组件（类名） | 现状 | 改法 |
|---|---|---|---|
| 1 | 页头条 `app.pageHeader` | 裸排 | 底 = `--pcy-paper`，下缘 2px 重墨线；文字（标题/计数语境）改 `--pcy-paper-ink`（纸面自洽配对）；~~精灵框 `pageHeaderSprite`~~ **验收回流（2026-10-16）：页头精灵剪影整体移除**（用户裁决——右侧选项与列表卡已有精灵，页头不重复），`pageHeaderSprite` 类随之删除；日期与 CAUGHT 进度**七段常显**（不再只在冒险段挂）；`pendingBadge` 底改行动红口径 `#e00f0f`（白字 5.0:1，替换现 `#ee1515` 4.4:1 缺口）+ 1px 墨线；装饰字 `pageTitleDeco` 属非信息装饰，字距 1.5px、色维持 alias |
| 2 | 七段导航 `app.segmentButton[aria-current]` | 蓝底白字 | **一等选中**：黄底 `--pcy-running` + 固定墨字 `#1a1b25` + 1.5px 重墨线 + 字重 700（~~`::before` 内容 `▶`~~ 验收回流去 ▶）；非 active hover 底 `--pcy-hover`；`segmentCount` 在 active 下底改 `rgba(26,27,37,.12)` |
| 3 | 背包分区选单 `settings.sectionNavButton[aria-pressed]` | 蓝底白字 | 同 #2（同一语言，同去 ▶）；选中项带未保存点时点色改墨底白点保对比 |
| 4 | 图鉴过滤胶囊 `tasks.filterButton[aria-pressed]` | 蓝底白字 | 同 #2（同去 ▶）；选中/未选中统一恒定 1.5px 边框（未选中透明占位，防宽变抖动——该类无 border-box）；复盘入口 `reviewEntry` 已黄底 → 补 1.5px 重墨线，与选中语言合流（不带 ▶） |
| 5 | 条目卡悬停 `tasks.taskCard:hover` | 灰描边 | 底改 `--pcy-hover`（桌面唯一悬停黄）+ 边框升重墨线；五呈现其余不变 |
| 6 | 列表行选中 `radio.messageRow[data-selected]` | 灰底蓝框 | **一等弱**：底 `--pcy-hover` + 1.5px 重墨线（不用 ▶ 与纯黄，理由见 §3.2）；选中/未选中统一恒定 1.5px 边框（透明占位防抖动）；行 hover 底 `--pcy-hover`；`rowBadge` 墨线升 l3 |
| 7 | 视图互切 `radio.viewToggle[aria-pressed]` | 软黄底 | 保持软黄（二等选中），边框升 `border-l3` |
| 8 | 批量托盘 `radio.batchBar` | 蓝粗框白底 | 底 `--pcy-paper` + 文字 `--pcy-paper-ink` + 1.5px 重墨线 + `2px 2px 0` 硬阴影（「托盘」隐喻） |
| 9 | 捕捉分隔 `radio.captureBar` | 2px 灰分隔 | 分隔线改重墨线 2px（桌面 3px navy 的宿主降档） |
| 10 | 精灵图鉴框 `settings.entitySprite` / `tasks.taskSprite` | 裸图 | 底 `--pcy-paper` + 1.5px 重墨线 + 4px 圆角（小件级），pixelated 不变；**回流（2026-10-17）：`tasks.taskSprite` 框整体移除（用户裁决——任务列表卡精灵裸图），仅 `settings.entitySprite` 保留框** |
| 11 | 分组框/左缘线 `radio.reasonMenu`、`settings.sshGroup/noteBlock` | l1/l2 灰 | 边框升 l3；左缘线统一 2px l3（`aiBox` 现状已是 1.5px l3，保持不动）；`tasks.summaryGrid` **不进纸色**（其内文字走 alias，主题错配会不可读——维持 alias 面板底） |

**主行动按钮换挡**（新增 `ui.buttonDex`，黄底固定墨字 + 1.5px 重墨线 + 2px 硬阴影 + 按压位移；
位点裁决 = 「该操作是此区块唯一主推进动作」）：`settings.saveButton`（保存）、`radio.pollNow`
（立即拉取）、CaptureBar 捕捉主按钮、DispatchRow「出发」、MessageActions「收进图鉴」与建议卡
「应用更新」（该建议的主行动）、BatchBar「全部收进图鉴」。其余按钮（忽略/建任务/取消/重判等）
维持宿主档。

**硬阴影使用面（唯一一档 `2px 2px 0`）**：进行中条目卡、批量托盘、主行动按钮、三处 LCD 框。
禁止 blur 阴影出现在以上元素（弹窗/抽屉的宿主软阴影除外——它们是 T0）。

### T2 屏——签名位（仅三处）

| # | 组件 | 改法 |
|---|---|---|
| 12 | 收音机全文 `radio.detailContent` | LCD 化（§3.3 全量）+ 扫描线 `::after`；字号/行高不动；`detailStatus` 章、`kbdChip` 改键帽档（bg-layer-1 底 + 墨线 + `0 2px 0` 墨色底沿 = 键帽） |
| 13 | 诊断日志屏 `settings.logList` | 包一层 LCD 容器（同上）；`logTime` 色 `--pcy-lcd-dim`（4.7/5.1:1，**不得用 `--pcy-lcd-dark`**——那是内阴影色 1.2~1.5:1），`logLevel` error/warn 用 `--pcy-lcd-log-*` |
| 14 | 已完成条目卡 `tasks.taskCard[data-presentation=done]` | LCD 化 mini：底 `--pcy-lcd` + 1.5px 重墨线 + 内阴影，标题删除线色 `--pcy-lcd-text`；辅助行（`taskMeta`/`taskNo`）同为 `--pcy-lcd-text` **实色**（不用透明度——透明叠加会跌破 4.5:1），徽章/精灵规则不变（灰度精灵 + 删除线已有） |

**已逃走态** `data-presentation=escaped`：底改 `--pcy-paper-dim`（桌面逃逸态同源色），其余不变（中性呈现、不催清零的原则保留）。

## 6. 交互与动效

- **零闪烁红线不变**：无任何 `animation` 声明（LED 呼吸/优先级闪烁不上面板——静态 LED/圆点 +
  文字冗余足够）；扫描线是静态背景纹理，不受限。
- **新增动效仅一档**：主行动按钮按压 `transform/box-shadow 80ms`（对齐 `--t-tap`），
  `prefers-reduced-motion: reduce` 下时长归零；条目卡不加按压动效（列表热区，避免整卡位移）；
  面板内不引入其余 transition。
- 键盘流/焦点序/命中区 ≥32px 全部维持现状（本次零交互逻辑改动）。

## 7. a11y 与约束自查

| 约束 | 核对 |
|---|---|
| 信息文字 ≥4.5:1 | 黄底墨字 11.2:1；LCD 亮 5.8:1（DESIGN_SYSTEM 口径）/ 暗 9.0:1；LCD 屏内 dim（时间戳）4.7/5.1:1；暗日志色 5.0/6.3:1；pendingBadge 白字改 `#e00f0f` 后 5.0:1；墨线仅作图形不作文字 |
| 既有豁免（不扩面，记入 `docs/debt.md`） | ① 已逃走卡整卡 opacity .6（≈4.0:1）——桌面同款的刻意「中性呈现、不催清零」，保留；② `dispatchBadge[data-state=done]` 固定浅底 + alias 字在暗色 ≈2.1:1——现状代码同病，本次不触（改动范围铁律），记债务；③ 装饰性非信息文字（`pageTitleDeco`）不设对比度要求 |
| 彩色小图形 3:1 兜底 | 徽章/圆点维持既有墨描边；黄色新选中态有字重 + 重墨线双冗余（▶ 已随验收回流全部移除）；暗色下黄底件的墨线退化为「与页面底的分界线」（1.25:1），状态识别靠字重 + aria 态兜底（成立） |
| 非颜色冗余 | 选中 = 字重 700 + 重墨线 + aria-current/aria-pressed（去 ▶ 后仍成立）；完成 = 删除线 + 灰度；置信/健康 = 文字标签（已有） |
| 命中区 ≥32px | 零布局尺寸改动，维持现状（选中态恒定 1.5px 边框透明占位防抖动） |
| focus-visible | 宿主蓝环全站统一，插件不覆写（黄底蓝环仅键盘导航瞬间同现，可接受） |
| 零闪烁 NFR-6 | 无 animation；新增 transition 仅 80ms 按压且支持 reduce 归零 |
| 圆角守卫 | 全部沿用宿主现有档位（4/6/8/10/12/999），未引入新圆角 |
| token 纪律 | 宿主面 100% alias；世界观色全走 `--pcy-*`，亮色值同源 DESIGN_SYSTEM；暗色配对值与 `--pcy-lcd-dim` 是仅有的派生新色（§4 已声明），单点声明于 `ui.module.css :root`，无散落 |

## 8. 不做清单（防「图鉴机皮肤硬贴进宿主」回摆）

- ❌ 机身红机脊/大灯、`--dex-body` 大面积铺底、3–4px 粗描边、4px+ 硬阴影进面板
- ❌ 像素字体（Press Start 2P / Fusion Pixel）加载进宿主（U6）
- ❌ LED 呼吸/紧急闪烁等循环动画（NFR-6）
- ❌ 扫描线出现在 LCD 三处之外
- ❌ 宿主蓝的焦点环/表单控件选中被替换（T0 纪律）
- ❌ conversation chip、mainPanel 壳的任何渗透（宿主领地）

## 9. 实施映射（改哪些文件）

| 文件 | 改动 |
|---|---|
| `dsh-plugin/src/client/ui/ui.module.css` | `:root` 暗色配对值声明块；新增 `buttonDex` |
| `dsh-plugin/src/client/app/app.module.css` | 页头条/精灵框/七段导航选中语言（T1 #1 #2） |
| `dsh-plugin/src/client/tasks/tasks.module.css` | 条目卡五呈现（hover/done LCD/escaped）+ 过滤胶囊 + 精灵框 + 抽屉左缘重墨线 |
| `dsh-plugin/src/client/radio/radio.module.css` | 列表行选中 + detailContent LCD + 键帽 + 托盘 + 捕捉分隔 + reasonMenu 升 l3 |
| `dsh-plugin/src/client/settings/settings.module.css` | 分区选单选中 + saveButton 换挡 + 精灵框 + 日志 LCD 屏 + 左缘线收编 |
| `dsh-plugin/src/client/chip/chip.module.css`、`dsh/mainPanel.module.css` | 不动 |

**tsx 改动面（仅 className 级换挡，不动结构与交互逻辑）**：主行动按钮位点按 §5 清单把
`ui.buttonPrimary` 换为 `ui.buttonDex`——`CaptureBar.tsx`（捕捉）、`DispatchRow.tsx`（出发）、
`MessageActions.tsx`（收进图鉴 / 应用更新）、`BatchBar` 消费点（全部收进图鉴）、
`SettingsSegment.tsx` 保存钮与 `HealthStrip` pollNow 所在文件；T2 #13 日志屏需在
`DiagnosticsSection` 的 LogViewer 外包一层容器 div。既有组件测试为 aria 属性 + textContent +
testid 驱动，`::before` 的 ▶ 不入 textContent、className 换挡不动 aria——断言不受影响，改后跑
`pnpm --filter dsh-plugin test` 兜底。

## 10. 原型说明

`uiux-prototype.html` 自包含、可离线打开（精灵图走 PokeAPI CDN，断线回落 emoji）：顶部为
before→after 对照条（选中/完成/进行中/阅读面四组），下为背包、收音机、诊断三页目标样式全样，
右上角可切亮/暗主题（暗色即 §4 配对值的实际效果）。原型字体 = 系统栈 + ui-monospace，与实现
口径一致（原型也刻意不用像素字体，避免「设计稿比实现多给承诺」）。
