# Spec Delta

## Purpose

dsh 桌宠的宿主→helper 配置下行面：共享键（主宝可梦、每宝可梦自定义台词、置顶/缩放/透明度窗口配置）投影下发、设置写后即推、台词惰性下发、窗口位置校验与重置、Electron 运行时首启进度透出。

## ADDED Requirements

### Requirement: 设置写后配置面即推

宿主侧任一设置写入路径完成后，SHALL 在同一写事务回调内重推 `sys-config`（桌宠基础面、窗口配置等随行），无需 helper 重启即可生效。

#### Scenario: 改设置即时生效

- **WHEN** 用户在 dsh 客户端设置面切换「陪跑精灵」开关且 helper 在线
- **THEN** helper 在下一次桥消息到达时收到含新 `pet.mate` 值的 `sys-config`，渲染层投影立即翻转

### Requirement: 主宝可梦下行

`sys-config.pet` SHALL 携带共享键 `main_pokemon` 的当前值（未设置时缺省）；helper 空闲（无进行中任务）时显示的精灵 SHALL 按链路解析：进行中任务分类精灵 → main_pokemon → pikachu 兜底。

#### Scenario: 空闲跟随主宝可梦

- **WHEN** 无进行中任务且 `main_pokemon` 设为 `eevee`
- **THEN** helper 精灵显示 eevee；用户改主宝可梦为 `snorlax` 后无需重启即切换

### Requirement: 自定义台词惰性下发

宿主 SHALL 仅对「当前相关精灵集」（主宝可梦 + 进行中任务精灵）下发 `pokemon_quotes` 中存在的自定义台词，相关集变化时重发；helper 单击/撸宠台词 SHALL 优先取当前精灵的自定义台词，无自定义时按深夜档（22:00–06:00）回退全局安睡池、其余时段回退默认池。

#### Scenario: 自定义台词优先

- **WHEN** 当前精灵为 psyduck 且用户为其编辑了自定义台词，用户单击精灵
- **THEN** 气泡从 psyduck 的自定义台词中随机取一条；深夜时段无自定义台词的精灵说出安睡池台词

### Requirement: 窗口行为配置下发

`sys-config.pet` SHALL 携带共享键 `pet_always_on_top`（默认 true）、`pet_scale`（值域 1 / 1.25 / 1.5 / 2，默认 1）、`pet_opacity`（值域 100 / 80 / 60，默认 100）；helper SHALL 据此：置顶开关关时取消 alwaysOnTop 且置顶看门狗停跑；缩放对窗口三档高度（330/480/590）与快捷屏 590 宽等比生效（左上角锚定），内部元素与 `.hit` 命中区随 CSS 缩放比例联动；透明度作用于精灵与气泡本体。

#### Scenario: 缩放联动命中区

- **WHEN** `pet_scale` 设为 1.5 且用户悬停精灵侧缘唤出 ☰ 钮
- **THEN** ☰ 钮与精灵命中区按 1.5 倍几何出现，点击判定与视觉尺寸一致

#### Scenario: 关闭置顶

- **WHEN** `pet_always_on_top` 切为 false
- **THEN** helper 窗口取消 alwaysOnTop，其他应用窗口可覆盖桌宠；重新切回 true 后置顶恢复且看门狗续跑

### Requirement: 窗口位置校验与重置

helper 建窗恢复记忆位时 SHALL 校验位置落在任一已连接显示器 bounds 内，越界（如显示器已拔除）则回落主屏工作区右下默认位；客户端设置面 SHALL 提供「重置位置」动作，触发后 helper 窗口回到默认位并清除宿主侧记忆位。

#### Scenario: 拔显示器后找回

- **WHEN** 记忆位所在的副屏被拔除后 helper 重启
- **THEN** 精灵出现在主屏右下默认位而非不可见坐标

#### Scenario: 手动重置

- **WHEN** 用户点击设置面「重置位置」且 helper 在线
- **THEN** 精灵即刻回到默认位，宿主侧 `dsh:pet_pos` 被清除

### Requirement: 首启进度透出

Electron 运行时按需获取（下载/校验/解压）的阶段与进度 SHALL 可经 rpc 查询；客户端设置面在首启等待期 SHALL 展示阶段化进度而非静态降级文案；运行时就绪或获取失败后进度行收敛为常态显隐行。

#### Scenario: 首启等待可见进度

- **WHEN** 用户首次开启桌宠触发运行时下载
- **THEN** 设置面「显示桌宠」行显示下载百分比或解压阶段；下载完成后行内警告消失、桌宠窗口拉起
