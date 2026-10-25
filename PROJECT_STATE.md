# PROJECT_STATE — Waterworks 3D

> 跨会话记忆文件。只在架构级变动 / 重大模块完成 / 会话收尾时更新。上次更新：2026-10-26（60 关 + 分页解锁；终局卡死修复；新手教程先读后玩；版本号 + 更新日志）。

## 1. 项目定位
- 3D 体素轻策略解谜游戏：下落地块 + **100% 确定性水流**模拟。商店标签 Strategy / Puzzle / Relaxing，定价锚点 $9.99。
- 宣传语：「每一块都在决定水的命运」。卖点：完美信息可预判、可回放、可分享短码、每日挑战本地榜。
- 纯单机：无后端 / 无账号 / 无网络请求 / 无外部 CDN 资源；音频用 WebAudio 合成。

## 2. 技术栈
- Vue 3 (Composition API) + Vite 6 + TypeScript 5.7 + Pinia 2 + Three.js 0.170（原生封装，不用 drei/tres）。
- 测试 Vitest 3；类型检查 vue-tsc。脚本：`npm run dev | build | test | typecheck`。
- 注意：本机 npm 全局缓存目录有权限问题，重装依赖需加 `--cache ./.npm-cache`。

## 3. 核心架构（分层铁律）
- `src/game/core/**`：**无框架纯逻辑**，同步、无 DOM、无 Three 依赖。
  - `simulation.ts` — 导出纯函数 `simulate(grid, water, tick, config)`：双缓冲（源快照→目标缓冲），固定流动顺序 下→左→右，管道/单向阀强制转向；**水量守恒**（去往他格/海绵/排水计数/溢出计数，不丢水）。
  - `engine.ts` — 确定性引擎：7-bag 出块、落块、锁定、目标判定、失败判定、计分。帧无关，由 store 以固定步长驱动。
  - `pressure.ts` 压力累积与结构破坏；`scoring.ts` 目标/三星/失败文案；`bag.ts` 7-bag 与旋转；`rng.ts` 种子 + `fnv1a`/`hashFloats` 状态哈希。
  - `replay.ts` 操作序列编解码与回放；`shareCode.ts` 短码压缩（**按块落点压缩**：tick/列/旋转/保留/投放方式，非逐按键，约 66 字符 + 哈希校验）；`daily.ts` 日期种子每日挑战；`level.ts` 关卡加载与编辑器 JSON；`campaign.ts` 60 关分页与顺序解锁纯函数；`editor.ts` 编辑器纯操作（画笔、排水口、初始水、缩放、块池、目标、校验）；`presentation.ts` 展示层策略（是否拉远 / 是否录分，纯函数、不进哈希）。
  - **回放两条路径**：`ReplayDriver` 驱动紧凑码（逐 tick 注入落点，终止条件 = 引擎终局）；`playbackLegacy` 驱动旧逐按键码（`tt` 为录制边界）。
- `src/game/three/**`：唯一接触 Three 的层。`SceneManager`（场景/循环入口）、`VoxelRenderer`（固体/预览/幽灵/落块各一个 `InstancedMesh`）、`WaterRenderer`（半透明水面高度）、`CameraController`（**正面视角**：`FRONT_AZIMUTH = π/2`、`FRONT_ELEVATION = 0.16`，拖动/按键方位角锁在正面 ±0.42 内，`refit()` 按视口反算距离，`manualZoom` 保留玩家手动缩放）、`Effects`、`WowMoments`（三个哇时刻）。
- 正面视角三条硬约束（勿回退）：①体素必须留缝（0.96/0.9 而非 1.0）+ 逐格亮度抖动，否则同材质相邻块糊成一堵墙；②背板 z=-0.82、网格线 z=-0.52、体素占 z∈[-0.45,0.45]，粒子/幽灵/落块放 z≈0.5 才能在体素前方，否则被深度测试吞掉；③落块出生在行 0 之上（允许渲染 `gy < 0`，下限 -2），取景的竖直半高按 `(rows + 2.8) / 2` 预留头部空间 —— 用 NDC 投影验证过：网格四边 + 最坏出生块顶点在所有 6 种视口比例下均 ≤ 0.9。
- `src/stores/**`：`gameStore`（局内状态）、`settingsStore`（静音/预览步数等）、`progressStore`（关卡进度、最高分、每日记录、分享码历史、`tutorialDone`，落 localStorage）、`tutorialStore`（**教程旁路观察者**：watch `gameStore.snapshot` → 转换为离散观察 → 调 `core/tutorial.ts` 的纯谓词；不写引擎。另有落地页 `intro`、简报闸门 `holdRun`→`gameStore.coachHold`、达成后 900ms 自动进下一步）。
- `src/components/**`：纯 UI（GameCanvas / Hud / NextPreview / TouchControls / TutorialOverlay / TutorialIntro / ChangelogPanel / 各 Overlay / MainMenu / LevelSelect / DailyChallenge / ShareCodePanel / ReplayOverlay / LevelEditor）。
- **版本号只有一个源**：`vite.config.ts` 读 `package.json.version` → `define __APP_VERSION__`（类型见 `src/env.d.ts`）→ `core/version.ts` 导出 `APP_VERSION`。组件与测试一律读它，禁止手写版本字符串；`core/changelog.ts` 是手写更新日志（纯单机无 release feed），`tests/changelog.test.ts` 保证首条版本 == package.json 版本、按版本/日期倒序。发版只改 `package.json` + 补一条 CHANGELOG。
- `src/game/core/blockGuide.ts` + `components/BlockGuide.vue`：主菜单「方块图鉴」。只有 role/summary/detail/caution 四段文案是手写的，名称/几何/颜色都从 `BLOCKS` 读；新增方块不补文案，`tests/blockGuide.test.ts` 直接红。
- 游戏循环：`composables/useGameLoop.ts` 固定步长 tick + rAF 渲染；Three 对象一律 `shallowRef`，避免深度响应式。

## 4. 关键不变量（改动前必看）
1. `simulate` 必须纯净：不改入参、返回新数组；同种子 + 同操作流 → 状态哈希逐位一致。
2. 水量守恒：任何减水必须落到另一格 / 海绵 / 排水 / 溢出。
3. 回放只依赖 (level, seed, 块落点序列)，不依赖真实按键时序。
4. 每类可视对象合并为单个 InstancedMesh（draw call 预算）。
5. 禁止真实流体引擎、禁止任何网络请求。

## 5. 当前进度
- 阶段 1（MVP）与阶段 2（每日挑战、本地榜、回放+分享码、压力爆裂粒子、交汇变色、排空拉远）**均已完成**。
- **关卡编辑器**已完成：可视化绘制地形/排水口/初始水、目标与块池权重、尺寸调整、草稿自动保存、JSON 导入导出、直接试玩；试玩使用 `editor` 模式，不写星级/最高分/分享历史，退出后回到编辑器。
- **60 张合同关卡**，选择页每 10 关一页（共 6 页），严格按顺序解锁：第 1 关默认开放，之后必须通关上一关。全部被贪心机器人验证可通关且目标/预算经标定；每日挑战、无尽模式可玩。
- **新手教程**（5 步，`levels/tutorial.json` + `core/tutorial.ts` 纯谓词 + `stores/tutorialStore.ts` 旁路观察者 + `components/TutorialOverlay.vue` + `components/TutorialIntro.vue`）已完成；`progressStore.tutorialDone` 落盘，旧存档缺字段视为未完成。
- 测试：19 个文件 / 177 用例全绿（守恒、碰撞、排水计分、确定性、回放一致性、短码往返、60 关可通关、分页/顺序解锁、模式可玩、教程谓词/状态机/旧存档/哈希不变、展示层隔离、回放投放与自然终局、回放逐帧下落与时长对齐、编辑器画笔/缩放/目标/校验）。
- 构建：JS 807.2 kB（gzip 220.2 kB）· CSS 56.7 kB（gzip 11.5 kB）。

## 5.1 教程模块铁律（新增功能别破坏）
1. `core/simulation.ts` 与 `core/engine.ts` **零改动**：教程不做任何教学特判。
2. 教程状态只存在于 `tutorialStore`，**不进 `getStateHash()` / shareCode / replay**；有回归测试守着。
3. 推进只由离散引擎事件（块锁定 / 排水计数 / 混色）驱动，教程文件内**零计时器**。
4. 教程关卡不进合同星级记录、不生成分享码（`core/presentation.ts` 的策略函数守卫）。
5. **中间步不播通关演出**：`gameStore.suppressWinPresentation` 是纯展示开关（由 `startLevel(id, { coached })` 传入），`WowMoments.triggerDrain(total, dur, withCamera)` 据此决定是否 `pullBack`。切步必须走 `CameraController.refitForNewScene()`（同步、清 `manualZoom`、取消 cinematic），而不是 `refit()`。

## 6. 踩坑记录
- `InstancedMesh` + `vertexColors: true` 但几何体无 color 属性 → 全部实例变黑。只靠 `instanceColor` 驱动。
- 相机距离硬编码导致板子被裁 → 按 FOV/宽高比/方位角投影包围盒反算 `fitToBoard()`。
- 分享码曾逐按键编码膨胀到 250+ 字符 → 改为按块落点编码（66 字符），哈希仍一致。
- `pollutionStrikes` 直接显示浮点 → HUD 出现 `1.0568/3`，改用 `Math.ceil`。
- 每日挑战继承带预置污水的底图 → 开局即三振，改干井起步 + 双清水口 + 温和 7-bag。
- Windows 编辑器原子保存产生 `.X.vue.1234.tmpdir` 触发 EBUSY 杀掉 Vite 监听 → `vite.config.ts` 加 `watch.ignored`。
- 教程「下一步」若靠 `satisfied` 即时推进，玩家会看不到自己刚做对了什么 → 改为谓词命中后**停在当前步**，由点击确认；`observe()` 在 `satisfied` 期间只更新锚点不再评估，避免重复触发。
- 教程快照还原「刚锁定的是什么块」必须用**上一帧**的 `piece.kind`：`snap.piece` 在锁定的同一帧已换成下一块，直接读会永远拿错。
- **教程步骤完成误触发通关拉远**：教程每步都是一个完整关卡，通关即 win，`GameCanvas` 在 `draining` 时无条件 `wm.triggerDrain()` → `camera.pullBack()`，切步又没人复位相机，于是「网格越来越小」且不可逆。修法在展示层隔离：新增 `core/presentation.ts` 纯策略 + `gameStore.suppressWinPresentation` 开关 + `refitForNewScene()` 同步复位，`engine.ts`/`simulation.ts` 一行未动。`GameCanvas` 里原本重复的 `cam.pullBack(3.0)`（`triggerDrain` 内部已拉过）一并删除。
- **回放两个 bug 同源**：①播放器只读 `payload.o`，而 v3 紧凑码解码后 `o: []`，于是 `handleAction` 一次都没调用，方块全在出生列直落；②`playbackCompact` 用「记录用完了」当停机条件，引擎再也拿不到 `step()`，永远走不到自然终局。修法：新增 `ReplayDriver`（逐 tick 推进、按记录 tick 注入列/旋转/投放、`manualGravity` 让块停驻），终止条件只由 `engine.status !== 'playing'` 决定。**教训：终局判定与终局副作用是两件事**——判定必须跑，副作用靠「回放不调用 onWin」天然为零，绝不能用同一处短路同时控制。
- **旧逐按键流不能改成引擎终局**：`replay.test.ts` 的语料尾部有空转 tick、并非自然终局，改用引擎判定会让 3 个既有断言回归。故 `playback()` 分流：有 `pl` 走 `ReplayDriver`，无 `pl` 的旧码保留 `tt` 作为录制结束边界（旧码本来就是逐 tick 录制，`tt` 是其固有语义）。
- **投放方式必须单独记录**：`Placement.h` 是「是否来自 hold」，不是「硬降/软降」。软降立即下移一格并清 `fallTimer`，自然下落要 `max(4, fallInterval)` tick，二值字段不足以表达，必须由记录 tick 承担时序。分享码版本随之升到 v4，v3 紧凑码显式拒绝并提示重新生成。
- `TutorialCondition` 原先用可变 `anyOf: BlockKind[]`，测试里 `as const` 产生 readonly 数组 → 全部改成 `readonly`，类型收得更准确。
- **回放必须逐 tick 渲染下落过程，不要直接插值终态**：`place()` 曾在记录的（其实是**锁定**）tick 内一次走完「转向→横移→下落→锁定」，屏幕上就是一帧瞬移。修法：块在锁定 tick 之前就转向并逐 tick 走引擎自己的软降路径（`handleAction('D')`，一 tick 一格），到点才 `A` 锁定。关键前提是**空中块不进 `getStateHash()`**（只哈希 clean/dirty/pressure/grid/tick），所以铺开下落不改变哈希；但窗口不足时（连续硬降挤在同一 tick）必须自动放大步长，仍准时锁定。`ghostY()` 必须每 tick 重读，缓存在沙块塌陷后会算错落点。
- **录制时长需在终局截断**：录制侧 `tt = e.tick` 本来就对（`step()` 先自增再判胜负），错的是播放侧用 `最后锁定 tick + 300` 估算，凭空多出 5 秒空转、进度条永远到不了 100%。改为 `totalTicks = payload.tt`，并在引擎停机时把播放进度吸附到 100%。
- **截断录制会让回放无限空转**：`pl` 有 4 条但引擎未判终局时，`ReplayDriver` 会一直跑到 tick 500 仍 `playing`。`finished` 增加 `allPlaced && tick >= tt` 兜底，但**排在引擎判定之后**，不得抢占真终局。

- **点「再打一次」相机不复位**：`restart()` 复用同一个 `level` 对象，`level.id` 不变 → `GameCanvas` 里 watch `level.id` 的重置整块被跳过，胜负拉远（`pullBack`）与 `recordedRun` 一起残留。修法：store 增加单调递增的 `runId`，每次 `newEngine` 自增，canvas 改以 `runId` 作为「换了一局」的信号；`tests/runIdentity.test.ts` 兜住。
- **「再打一次」只回默认视角、丢掉玩家自己的视角**：上一次修复把 watch 键换成 `runId` 后确实复位了，但复位的是 `refitForNewScene()` 的**默认**正面取景，玩家在打这一局时拖过/缩过的视角被一起抹掉。修法：`CameraController` 加 `capturePose()/restorePose()/keepView()`；`GameCanvas` 在 `triggerDrain` 之前抓一份 pose，重开同关卡时 `restorePose`，换关卡仍 `refitForNewScene`，局内按 R 只 `keepView`（一帧都不许动）。`CameraSnapshot` 必须带上 `manualZoom`——否则恢复后下一次 refit 会把玩家的缩放吃掉。
- **回放曾是「只记落点」**：v4 分享码按块存 tick/列/旋转，回放只能把块「插」到落点，看不到一格一格横移和下落。升级到 **v5：完整操作流按 7bit/op 位打包**（3bit 动作 + 4bit tick 差，差值>=16 用转义 + 16bit）。播放端 `ReplayDriver` 在 `payload.o` 非空时改走操作流、正常重力（不再 `manualGravity`）；`playback()` 优先 `o`，`pl` 只作 v4 回退。空格硬降在规则里是单 tick，新增 `engine.hardDrops`（纯渲染日志、不进哈希）+ `DropTrails` + `VoxelRenderer.trailMesh` 播放 0.18s 飞落动画。**教训：只校验终局哈希的回放测试全部通过，但屏幕上一帧瞬移——必须按 tick 比对坐标。**
- **箭头从来没被画出来**：管道/单向阀原来只做 `rotation.z = dir*90°`，而立方体旋转 90° 外观完全一样，所以图鉴写着「沿箭头方向」而屏幕上没有箭头。修法：`VoxelRenderer.arrowMesh`（ShapeGeometry 箭头，实例化）+ 落地格子与**飞行中的方块**都画；`Snapshot.piece.dir` 补齐；HUD 保留槽、Next 预览、主菜单图鉴用同一个 `arrowQuarterTurns(dir)`。**教训：CSS 三角/Three 箭头默认朝上，`dir` 本身就是转向次数（恒等映射）；写成 `dir-1` 会让箭头偏 90°，比不画更误导——`tests/arrow.test.ts` 用实例矩阵反解角度兜住。**
- **新手教程是「先读后玩」+ 自动推进**：`startTutorial()` 只开落地页（`TutorialIntro.vue`，**唯一**有「跳过教程」的地方）；`begin()` 才载入第 1 步，且 `holdRun` 把 `gameStore.coachHold` 置真——`dispatch`/`stepOnce` 都提前返回，水流与输入全停，玩家关掉（`dismiss()`）提示才开始。达成谓词 → `satisfied` 上升沿重开气泡显示 ✔ 并 900ms 后自动 `next()`（无「下一步」按钮）。`briefed` 区分「首次简报」与「点胶囊回看」：回看不再冻结对局；`restart()`/`runId` 变化 = 新的一次简报。桌面端气泡居中（≤720px 退回底部卡片）。
- **手机端没有任何重开按钮，而且「暂停」被自己的 click 立刻恢复**：`TouchControls` 原来只有六个落块动作；新加的暂停若在 `pointerdown` 上执行，抬手时会再合成一次 click，落到刚挂载的暂停遮罩上，触发 `.overlay @click.self` 立即 resume——看起来像按钮没反应。修法：meta 按钮改 `@click`，遮挡层关闭用 `click.self`；触摸条拆成「落块动作组」与「重开/暂停组」，窄屏（≤460px）两行布局，动作组在暂停/结束时才禁用，meta 组始终可点。另给暂停卡加右上角 ×，并让手机端 next/保留面板上移避开触摸条。
- **最后一块用完后画面卡死**：终局判定不只在 `step()`（溢出/污染/堵排水口/达标），`lockPiece()` 里也有——最后一块落定触发 `outOfBlocks`，`hold` 换块无空间触发 `noSpace`，两者都发生在 `handleAction()` 内。store 原来只在 `stepOnce()` 里读 `status`，于是「硬降最后一块」这类操作会直接把循环停掉：没有下落的块，也没有失败卡，看起来就是死机。修法：`settleRun()` 统一收口终局（按 `runId` 幂等，防止重复触发 onWin 的延时器），dispatch 与 stepOnce 都调用；教程步骤失败也必须出卡（`ResultOverlay.cardVisible` 只对 tutorial 的**胜利**隐藏），`restart()` 用 `coachedRun` 保住教练标记，`tutorialStore` 里监听 `showResult` 的地方必须校验 `result.won`（否则失败会把步骤打成 ✔）。`tests/dispatchTerminal.test.ts` 兜住。
## 7. 下一步计划（未做）
- 移动端手势（滑动旋转/缩放）与性能降级档位；端上 60fps 实测。
- 商店页素材：三张截图（交汇变色、压力爆发、排空拉远）+ 宣传片分镜。
