# 设计系统焕新方案 — Design Refresh Proposal

> 版本：2026-09-19 · 状态：待定稿（配套演示页 `design/design-refresh-demo.html`）
> 范围：`design/DESIGN_SYSTEM.md` 自初版定稿后未再更新，本文档做三件事——
> ① 信息对齐：盘点「文档 ↔ 实现」的全部漂移；② 调研：2026 年复古像素风 UI 的最佳实践；
> ③ 焕新方案：令牌层 v2 + 组件规范补全 + 可访问性底线 + 落地路线。

**一句话结论**：现有「图鉴复古风」的骨架（粗描边 + 硬阴影 + LCD 绿屏 + 低密度大目标）与当代像素风/新粗野主义最佳实践高度同构，方向不需要推翻；需要的是**收编散落的硬编码、补齐缺失的规范（收音机两栏、诊断中心等新界面）、修掉可访问性硬伤（灰色阶与徽章对比度、焦点样式、像素字网络依赖）**。风格化与视觉友好不是取舍关系——本方案的每个决定都同时服务两者。

---

## 一、信息对齐：文档 ↔ 实现漂移清单

以 `src/` 当前实现为准逐项核对 `DESIGN_SYSTEM.md`（初版，9 月 15 日）：

### 1.1 已过时的条目

| # | 文档条目 | 实现现状 | 证据 |
|---|---|---|---|
| 1 | §2 字体：「Zpix/Fusion Pixel 中文像素打包内置」 | **从未实现**。全仓库无该字体引入；中文实为系统字体回退（Noto Sans CJK SC / PingFang），且无 900 字重；Press Start 2P 走 Google Fonts **网络依赖**（本地优先应用断网掉字） | `src/dex.css:30`、`index.html:7-8` |
| 2 | §1 分类表：固定 6 属性（社交=火/伊布、紧急=龙/卡比兽） | 分类已改为**用户可增删/停用 + PokéAPI 1025 只在线换装**；默认阵容含「兴趣」`--type-interest #ee99ac`（文档缺失）；社交/紧急仅存留量配色 | `src/dex.css:11-18`、`src/views/SettingsTab.vue` |
| 3 | §4.2 主面板：「内容区顶部一行大按钮筛选（今日/收件箱/已排期/图鉴）」 | 不存在。筛选仅在图鉴页（全部/已捕捉/已逃走 + 复盘入口）；导航为 冒险→路线→草丛→图鉴→收音机→设置 六项，计数徽章挂收音机 | `src/App.vue:26-33`、`src/views/TaskTab.vue:207-218` |
| 4 | §4.2「IM 建议页：LCD 条目卡 + 捕捉/逃走两按钮」 | 已被**收音机两栏分诊**整体取代：320px 列表栏（信号/噪音分区、频道聚合、批量条）+ 详情栏（LCD 全文、AI 建议盒三态、键盘流 C/X/F、5 秒撤销 toast、逃走原因码）。文档完全缺失此模式 | `src/views/RadioTab.vue`、原型 `design/radio-triage.html` |
| 5 | §3「描边统一 3px」 | 实际多档并存：3px 主 / 2px 小件 / 2.5px 徽章 / 4px 机壳级（机脊、抽屉）/ 1.5px 会话徽章——**多档本身合理，但未成文** | 全局审计 |
| 6 | §4.4 尺寸：「最小点击目标 40×40」「控件统一 38px」 | 未守住：卡片操作钮 36px、筛选钮 36px、批量条 30px、桌宠药丸钮 30px；控件 36/38 混用 | `TaskCard.vue:239`、`RadioTab.vue:960`、`PetApp.vue:551` |
| 7 | §5 动效参数 | 跳跃 -7px（写 -6px）、抖动 ±4px（写 ±3px）；「捕捉成功：精灵球旋转+闪黄」未实现；未记录的新动效：撸宠弹跳、番茄尾段焦急加速跳、抽屉 slide-in、健康灯闪烁、机脊大灯 >6 任务转常亮（反焦虑设计） | `src/dex.css:193-213`、`PetApp.vue` |
| 8 | §4.3 桌宠 | 已实现但文档缺失：番茄**色环**（绿→琥珀→红）、就近提醒动作条（✔完成/⇨推迟）、任务切换浮层、单击/双击/右键语义、主宝可梦 + 每只自定义台词、🍦先试 5 分钟、窗口 300×330↔590 自动调高 | `src/PetApp.vue` |

### 1.2 文档缺失、实现已定型的内容

- **设置中心**：七分区「初代菜单」选单、920px 限宽、132px 两栏表单行、底部状态栏。
- **诊断中心**：三色健康点（绿/琥珀/红闪烁）+ 状态 chip + LCD 日志屏（级别着色）。
- **组件**：PokemonPicker、DexContextMenu（右键菜单）、PokemonSprite（三级回退）、TaskDetailDrawer（400px 右抽屉 + LCD 属性总览）、TaskEditModal（460px）、ReviewWizard（480px 四步向导）、AddTaskForm 自然语言预览条。
- **z-index 层级体系**：20/30/60/70/80/90 实际并存，未成文。
- **可访问性**：减动效双通道（系统偏好 + 应用内开关）已实现且超前，但文档无「无障碍」章节；focus-visible 仅 1 处定制；aria 零散（集中在 RadioTab 新代码）。
- **i18n**：三语（zh-Hans/zh-Hant/en）即时切换，文档未提。
- **mockup.html** 整体过期（旧导航名、无收音机两栏），需注明以 `radio-triage.html` 为收音机页原型或一并重画。

### 1.3 实现侧的「隐性漂移源」：硬编码颜色

审计发现**同一视觉角色多个色值**并存，这是风格走样的真正来源（不再是缺规范，而是规范没覆盖新场景）：

| 角色 | 现存色值 | 出现处（示例） |
|---|---|---|
| 辅助灰文字 | **8 种**：#9a937f / #7b7460 / #6b6657 / #43413a / #555 / #666 / #777 / #999 | TaskTab:312、TaskCard:204、RadioTab:805、SettingsTab:1456、PetApp:690 等 |
| 悬停/选中黄 | 4 种：#fff3c4 / #fff6c4 / #fff8e6 / #fff3d6 | DexSelect:111、RadioTab:839、RadioTab:1062 |
| 成功绿 | 3 种：#dff3e4 / #2e9e5b / #5be36b | RadioTab:1093、SettingsTab:1519、dex.css:131 |
| 警示琥珀 | 3 种：#a1660a / #c98a06 / #f5a623 | TaskCard:196、SettingsTab:1523、PetApp:40 |
| 标签胶囊蓝 | #8a97b8（两处重复硬编码） | TaskCard:224、RadioTab:1078 |
| 休息蓝 / 日志红黄 | #3c5aa6 / #ff6b6b·#ffd166 | PetApp:544、SettingsTab:1659 |

> 值得肯定：全局审计**没有任何模糊阴影**，「禁止 blur」这条红线守住了；遮罩统一 rgba(28,34,68,.35~.45)。

---

## 二、像素风 UI 最佳实践调研（2026-09）

### 2.1 混合排版是行业共识：像素字管「展示」，清晰字管「阅读」

- 游戏开发社区（[Reddit r/GameDevelopment](https://www.reddit.com/r/GameDevelopment/comments/1nv7sxr/best_practices_in_integrating_nonpixel_elements)、[Unity Forum](https://discussions.unity.com/t/how-do-you-best-handle-ui-in-a-pixel-art-game-pixel-perfect/885320)）的共识：**长文本用像素字体不可读**，主流做法是「像素美术 + 现代清晰正文字体」的混合（hybrid）方案。
- 本项目实际已经是混合方案（Press Start 2P 只用于英文/数字，中文正文走 Noto 系）——**歪打正着，且是对的**。要做的是把它从「事实」升格为「规范」：三层字体体系（见 §3.3）。
- 中文本地化的关键进展：**Fusion Pixel（缝合像素字体）**，SIL OFL 1.1 开源可商用，8/10/12px 三档点阵、比例/等宽两版、简繁日韩全覆盖（[GitHub: TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)）。网页/工程接入用 npm 分包 `@vp-tw/cjk-web-fonts-fusion-pixel-font`（按 unicode 块切 78 个 woff2 子集，浏览器只下载用到的子集，CDN 与本地导入均已实测渲染成功）——这解决了初版设计文档想内置中文像素字但没法落地的痛点。

### 2.2 「图鉴复古风」与新粗野主义（Neobrutalism）同构，且天生利于可访问性

本项目「3px 深描边 + 零模糊硬阴影 + 扁平饱和色」的组合，正是 2024–2026 持续流行的[新粗野主义](https://matejlatin.com/blog/neo-brutalism-ui-design-trend/)的 CSS 特征（[The Plus Addons 的拆解](https://theplusaddons.com/neo-brutalism-web-design-examples-css/)：thick borders / hard offset shadows / flat saturated fills）。

关键洞察（[NN/g 对比度与视觉层级原则](https://www.nngroup.com/articles/contrast-in-ui-design/)、[efeele.dev 的分析](https://efeele.dev/blog/neobrutalism-on-the-web/)）：

- **粗深描边天然提供边界对比**——本项目所有彩色小元素（优先级点、LED、徽章）都带 navy 描边，这是「彩色图形对比度不足 3:1 时的正确兜底」，已无意中做对，应写成规范。
- 风格的风险不在描边和阴影，而在**无序**：随机粗细、随机偏移、随机灰会破坏「未完成美学」与可用性的平衡。对策就是令牌分档纪律（§3.2）。
- 高饱和扁平色 + 深描边整体上**提升**扫读效率（视觉诚实：边界即结构），这支持「风格化与视觉友好同向」的判断。

### 2.3 像素网格纪律：比例一致比「全部像素化」更重要

- 像素 UI 一致性感来自**固定像素比例**：字体用原生点阵的整数倍渲染（Press Start 2P 原生 8px → 只用 8/16/24px，避免次像素插值发虚，[GDevelop 论坛的渲染讨论](https://forum.gdevelop.io/t/pixel-art-fonts-are-fuzzy-blurry/28014)）；间距走 4px 基准网格；精灵图 `image-rendering: pixelated` 已有。
- 现状反例：TaskCard 的 `No.xxx` 编号用 9px 像素字（非 8 倍数，轻微发虚）；圆角 4/8/12px 并存需成文分档。
- 参考 [Game UI Database](https://www.gameuidatabase.com)（1300+ 游戏、55000+ UI 截图）可继续挖掘同风格案例（Sea of Stars / Dave the Diver 等现代像素游戏的 UI 均为「像素美术 + 高分辨率清晰 UI 层」混合）。

### 2.4 对比度实测（本次逐色计算，WCAG 2.1）

| 组合 | 对比度 | 判定 |
|---|---|---|
| LCD 文字 `#3A4A32` on `#C4CFA1` | 5.8 : 1 | ✅ AA |
| 辅助灰 `#9a937f` on 米白 `#F5F0DC` / 白 | 2.7 / 3.1 : 1 | ❌ 小字需 4.5 |
| 辅助灰 `#6b6657` on 米白 / 白 | 5.0 / 5.7 : 1 | ✅ AA（最浅可用灰） |
| 水徽章 `#6890F0` + 白字 | 3.1 : 1 | ❌ |
| 草徽章 `#78C850` + 白字 | 2.1 : 1 | ❌ |
| 同上底色 + **navy `#1A1B25` 深字** | 5.6 / 8.3 : 1 | ✅（水/草/一般/兴趣全部达标） |
| 电徽章 `#F8D030` + `#A1871F` | 2.3 : 1 | ❌；换 navy 深字 → 11.4 ✅（保复古金可改 `#6B5A10` → 4.5） |
| 红按钮 `#EE1515` + 白字 | 4.4 : 1 | ⚠️ 边缘；`#E00F0F` → 5.0 ✅（视觉无感差异） |

结论：**徽章浅底一律 navy 深字**（含电底 11.4:1；navy 本就是全局描边色，视觉自洽；仅红/紫等深底保留白字，紫底白字 5.8 ✅）；灰阶收编为三档并把最浅文字灰定在 `#6b6657`。

### 2.5 注意力友好立场 = 游戏 UI 可访问性的超前实践

README 的七条注意力原则（默认安静、打断可拒、被动信号、动效即信息、一次强调一事、不制造羞耻、常驻不霸占）与游戏可访问性指南的方向一致：闪烁元素同屏 ≤1、低频循环、尊重系统减弱动态偏好。已有的减动效双通道（`prefers-reduced-motion` + 应用内开关，`dex.css:215-232`）应作为**规范亮点**写进文档，而不是散落在代码注释里。

---

## 三、焕新方案

### 3.0 设计原则（在原 5 条基础上修订为 7 条）

1. 像素是皮肤，不是氛围引擎——风格只出现在「展示层」，信息阅读层永远清晰优先。
2. 描边/阴影/圆角**分档纪律**——档位数有限、每档有名字，禁止档外取值。
3. 低密度大目标——点击目标分级 44/38/30，命中区不小于 38。
4. 动效即信息，同屏最多一个闪烁元素。
5. 对比度是硬约束——正文与语义文字 ≥4.5:1；彩色小图形靠 navy 描边兜底 3:1。
6. 减动效双通道永远生效。
7. 本地优先——**字体本地打包，不依赖网络**。

### 3.1 Token 层 v2：把 1.3 的散落色值全部收编

新增语义令牌（追加进 `dex.css`，存量视觉零变化、只做归一）：

```css
:root {
  /* 语义墨色（替代 8 种散灰） */
  --ink: #1A1B25;          /* = --dex-navy，正文标题 */
  --ink-soft: #6B6657;     /* 唯一的辅助文字灰，米白/白底均 ≥4.5:1 */
  --ink-faint: #9A937F;    /* 仅装饰（分隔虚线、非信息像素编号 ≥16px 场景） */
  /* 状态色（三源归一） */
  --ok: #2E9E5B;  --ok-soft: #DFF3E4;  --ok-ink: #1D6B3C;
  --warn: #C98A06; --warn-soft: #FFF3CD; --warn-ink: #8A5E06;
  --danger: #E00F0F;       /* --dex-red 微调，白字 4.5+；纯装饰性红仍可用 #EE1515 */
  --hover: #FFF3C4;        /* 唯一悬停/选中黄 */
  --tag-pill: #8A97B8;
  --rest-blue: #3C5AA6;
  --log-error: #D64545; --log-warn: #B8860B;  /* LCD 屏内文字，对 LCD 底 ≥4.5 */
  /* 置信三档（收音机专用，radio-triage.html 原型已有雏形） */
  --conf-high: #5BE36B; --conf-mid: #FFCB05; --conf-low: #C9C3AE;
  --conf-high-soft: #DFF3E4; --conf-mid-soft: #FFF3D6; --conf-low-soft: #ECEADA;
  /* 分类徽章文字色（浅底深字方案） */
  --badge-ink: #1A1B25;    /* 浅底徽章统一 navy 深字；红/紫深底保留白字 */
}
```

收编原则：**先加令牌、再机械替换**（grep 旧色值 → 换令牌），每替换一类跑一遍视觉回归，不与任何功能改动混在同一 PR。

### 3.2 描边 / 阴影 / 圆角分档（成文现状 + 微调）

| 档位 | 描边 | 阴影 | 圆角 | 用途 |
|---|---|---|---|---|
| 机壳级 | 4px | 8px 8px 0 | 16px | 主窗口外框、机脊右缘、抽屉左缘 |
| 卡片级 | 3px | 4px 4px 0 | 12px | 任务卡、设置卡、弹窗（浮层阴影 6px） |
| 控件级 | 3px | 3px 3px 0 | 8px | 按钮、输入、下拉、stab |
| 小件级 | 2px | 2px 2px 0 | 4px | chip、kbd、小图标钮、徽章（2.5→2px 归档） |

- 按下态统一：位移 = 阴影一半（4→2、3→2、2→1），80ms。
- 1.5px 会话徽章描边归入小件级 2px。
- **维持红线：任何地方禁止 blur 阴影、禁止渐变阴影。**

### 3.3 字体三级体系（初版文档「Zpix 内置」的正确落地）

| 层 | 字体 | 用途 | 尺寸（点阵倍数纪律） |
|---|---|---|---|
| 像素英文 `.px` | Press Start 2P（**本地打包**） | 编号、时间、ADVENTURE 等 LCD 英文、Logo | **只用 8/16/24px**（现状 9px 归 8px） |
| 中文展示 `.px-cn` | Fusion Pixel 12px Proportional 简体（**本地打包**） | 页面标题、分区标题、徽章内中文、机脊标题 | 12/24px |
| 正文中日韩 | Noto Sans CJK（系统栈，保持现状） | 所有正文、备注、消息全文 | 12/13/14/16/18px |

落地方式：`npm i @fontsource/press-start-2p @vp-tw/cjk-web-fonts-fusion-pixel-font`，在 `main.ts` import 对应 CSS——**同时移除两个 HTML 里的 Google Fonts `<link>`**，一并去掉 CSP 里的 fonts.googleapis.com 放行。断网不再掉字，冷启动无字体闪烁。繁体界面追加同包 `zh_hant` 变体。

> ⚠️ 踩坑记录（本次实测）：`@fontsource/fusion-pixel-12px-proportional-sc` 只含 **latin 子集**（index.css 仅 1 个 @font-face），中文字符不在任何 unicode-range 内，全量回退系统字体——不能用于中文。正确包是 `@vp-tw/cjk-web-fonts-fusion-pixel-font`：按 unicode 块切 78 个 woff2 子集（浏览器按需下载），CDN 引用与本机 npm 导入均已验证渲染成功；其 `local()` 前置匹配对已装 Fusion Pixel 的机器直接命中本机字体，零下载。

### 3.4 组件规范补全清单（DESIGN_SYSTEM.md 需新增的章节）

1. **收音机两栏分诊**（以 `radio-triage.html` 为原型）：320px 列表栏 + 详情栏、信号/噪音分区折叠、频道聚合模式、批量操作条、置信三档、kbd 快捷键 chip、5 秒撤销 toast、逃走原因码弹层、全键盘流（↑↓/J/K/C/X/F/Esc）。
2. **设置中心**：初代菜单 stab 选单（▶ 光标 + 黄底 active）、920px 限宽、132px 两栏行、底部固定状态栏。
3. **诊断中心**：健康三色点 + 状态 chip + LCD 日志屏（级别着色用 `--log-*`）。
4. **浮层与层级**：z-index 分层表 dropdown 60 / drawer 70 / modal 80 / wizard 90 / context-menu 95 / toast 100；遮罩统一 `rgba(28,34,68,.42)`。
5. **任务卡四态**：普通 / 进行中（黄 outline + ♪ + 跳跃）/ 已捕捉（LCD 化 + 删除线 + 灰度精灵）/ 已逃走（米灰淡出）。
6. **桌宠补全**：番茄色环三段变色 + 尾段焦急、就近提醒动作条、切换浮层、单击/双击/右键语义表。
7. **动效总表更新**：修正跳跃 -7px、抖动 ±4px；补撸宠、焦急跳、slide-in、health-blink；**删除**「精灵球旋转 + 闪黄」（未实现，改为已捕捉卡的静态 LCD 化，符合「动效即信息」）。

### 3.5 可访问性底线（新增章节，P1 落地）

- **全局焦点样式**（现在几乎裸奔）：`*:focus-visible { outline: 3px solid var(--poke-yellow); outline-offset: 2px; }`——黄 outline + navy 描边双保险，与进行中任务卡同语言；演示页 Section F 可体验。
- **灰阶纪律**：信息型文字只用 `--ink` / `--ink-soft`；`--ink-faint` 仅装饰。
- **徽章深字方案**（§2.4）：浅底 navy 深字，电底 `#6B5A10`。
- **点击目标分级**：主操作 44、控件 38、次级图标钮视觉 30 但**命中区 padding 扩到 ≥38**。
- **闪烁纪律**：闪烁频率 ≤3Hz、同屏 ≤1 个闪烁元素、时长有限（现有 pk-blink 0.6s ≈1.7Hz 合规，写入文档）。
- aria 补齐清单：机脊导航 `aria-current="page"`、stab `aria-pressed`、筛选钮 `aria-pressed`、任务卡操作钮 `aria-label`（RadioTab/DexToggle/DexContextMenu 已达标，照此补旧组件）。

### 3.6 暗色模式：本期不做，只留缝（P2/可选）

复古掌机风天然适合「背光屏夜览」暗色主题（深灰机身 + LCD 变暗绿/琥珀），但当前无任何 `prefers-color-scheme` 基础。本方案只做一件事：**新令牌全部语义命名**（surface/ink 语义而非颜色语义），未来暗色 = 换 token 值，不动组件。不在本期排期。

---

## 四、落地路线

| 阶段 | 内容 | 性质 | 验收 |
|---|---|---|---|
| **P0 定稿** | 本方案 review + 演示页定稿 → 重写 `DESIGN_SYSTEM.md`（吸收 §3 全部）、mockup.html 标注「历史版」或重画 | 文档 | 演示页逐项确认；新文档与 dex.css 交叉引用一致 |
| **P1 Token 收编** | dex.css 加语义令牌 → 全局机械替换 8 灰/4 黄/3 绿/3 琥珀等硬编码 → 描边阴影归档（2.5→2、1.5→2） | 纯 CSS，零功能 | grep 无散落 hex（白名单：令牌定义处）；三语截图回归 |
| **P1 字体本地化** | npm 双字体打包（press-start-2p + @vp-tw fusion 子集包），import CSS 后由 Vite 收编 woff2 为本地资源；移除 Google Fonts link 与 CSP 放行；`.px-cn` 中文展示层接入；9px→8px | 低风险 | 断网启动字体正常；冷启动无 FOUT |
| **P1 焦点与徽章** | 全局 :focus-visible；徽章深字 + `--type-work-t` 加深；`--danger` 定值 | 纯 CSS | 键盘走查主窗口全路径；对比度复核表 |
| **P2 组件文档化** | §3.4 清单成文进设计系统；mockup 重画（收音机两栏 + 诊断 + 设置 stab） | 文档 | — |
| **P3 可选** | 暗色主题、点击目标 36→38 归一、aria 补齐 | 功能 | — |

依赖关系：P0 无依赖可立即做；P1 三项互相独立可并行；P2/P3 随版本排期。

---

## 五、演示页使用说明（定稿流程）

`design/design-refresh-demo.html`（浏览器直接打开）按本方案 §3 渲染全部令牌与组件，六个分区：

**A 色彩令牌总表**（含对比度标注）→ **B 字体三级**（含点阵倍数标注）→ **C 组件画廊**（按钮三态、徽章新旧对比、LED、kbd、置信三档、LCD）→ **D 任务卡四态** → **E 收音机详情栏示意** → **F 焦点样式体验区**（用 Tab 键实际走一遍）。

定稿方式：逐分区过目，对色值/尺寸有异议直接改演示页顶部 `:root` 令牌区当场看效果，确认后把令牌抄回 `dex.css` 并更新本方案状态为「已定稿」。

> 演示页字体说明：为单文件可移植，Press Start 2P 走 Google Fonts、Fusion Pixel 走 jsdelivr（`@vp-tw` 子集包，已验证）；正式落地走 npm 本地打包（§3.3），CDN 仅演示用。若 CDN 不可达，页面自动降级 Noto Sans 900，布局不塌。

---

## 附：调研来源

- [Reddit: Best practices in integrating non-pixel elements in pixel art game](https://www.reddit.com/r/GameDevelopment/comments/1nv7sxr/best_practices_in_integrating_nonpixel_elements) · [Unity Forum: Handling UI in Pixel Art Games](https://discussions.unity.com/t/how-do-you-best-handle-ui-in-a-pixel-art-game-pixel-perfect/885320) — 混合排版共识
- [NN/g: The Visual Principle of Contrast in UI Design](https://www.nngroup.com/articles/contrast-in-ui-design/) · [Matej Latin: Neo Brutalism UI](https://matejlatin.com/blog/neo-brutalism-ui-design-trend/) · [efeele.dev: Neobrutalism on the web](https://efeele.dev/blog/neobrutalism-on-the-web/) · [The Plus Addons: Neo-Brutalism CSS](https://theplusaddons.com/neo-brutalism-web-design-examples-css/) — 新粗野主义特征与可访问性
- [GDevelop Forum: pixel fonts fuzzy/blurry](https://forum.gdevelop.io/t/pixel-art-fonts-are-fuzzy-blurry/28014) — 点阵整数倍渲染
- [TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)（SIL OFL 1.1）· npm `@vp-tw/cjk-web-fonts-fusion-pixel-font`（CJK 子集分包） — 中文像素字
- [Game UI Database](https://www.gameuidatabase.com) — 同风格案例库
