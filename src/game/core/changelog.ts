/**
 * Changelog data for the in-game 更新日志 panel.
 *
 * Hand-written on purpose: the game ships offline with no network, so there is
 * nowhere to fetch a release feed from, and a human-written line is worth more
 * to a player than a commit list. Order is newest first; `APP_VERSION`
 * (package.json) must be the head entry — `tests/changelog.test.ts` enforces it.
 */

export type ChangelogTag = '新增' | '改进' | '修复';

export interface ChangelogItem {
  tag: ChangelogTag;
  text: string;
}

export interface ChangelogEntry {
  /** Semver as written in package.json, without the leading v. */
  version: string;
  /** Release day, YYYY-MM-DD. */
  date: string;
  title: string;
  items: ChangelogItem[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.10.0',
    date: '2026-10-26',
    title: '挑战模式与成就',
    items: [
      { tag: '新增', text: '挑战模式：60 关全部开放，过关条件从「完成合同」改成求解器算出的「人类节奏」最高分。' },
      { tag: '改进', text: '求解器按策略标注来源：只有逐块实时下落的线才作为目标分，tick 0 连锁硬降只作内部参考、不发布。' },
      { tag: '改进', text: '合同 21「对冲」重做：排污口移到中井内侧、目标 8→5 单位，普通对局与挑战都明显变好打。' },
      { tag: '改进', text: '求解器补上「保留 / 交换」动作：挑战目标分随之上调（48 关受益，多数 +15，等于少用一块），第 1 关 135 → 150。' },
      { tag: '新增', text: '结算弹窗新增「认输」：记录一次认输，并直接给出该关的官方回放码，可一键回放。' },
      { tag: '新增', text: '12 个成就，覆盖合同星级、挑战进度、认输次数与连击；只有机器线的关卡不计入挑战成就的分母。' },
      { tag: '新增', text: '设置面板：静音、水量预览、音量、画质、减少动效，以及「格式化存档」。' },
      { tag: '新增', text: '存档导出 / 导入：一键导出压缩存档（进度 + 挑战 + 成就 + 设置），导入前整份校验，坏文件不会覆盖旧存档。' },
      { tag: '改进', text: '存档改成数组 + base64（WWSAVE1:…），同样的内容体积约降到 31%，旧版 JSON 存档仍可直接导入。' },
      { tag: '改进', text: '挑战模式不再写入合同星级、最高分与累计分，只记挑战自己的目标达成与认输次数。' },
      { tag: '新增', text: '主菜单新增设置入口与成就入口。' },
      { tag: '改进', text: '新增 challenge.json：60 关目标分与官方回放码，全部由求解器生成，测试里逐条回放对齐分数。' },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-10-26',
    title: '合同战役与关卡编辑器',
    items: [
      { tag: '新增', text: '60 份合同关卡，每 10 关一页，通关上一关才解锁下一关。' },
      { tag: '新增', text: '可视化关卡编辑器：地形画笔、排水口、初始水、块池与目标，可直接试玩并导出 JSON。' },
      { tag: '新增', text: '主菜单方块图鉴，按类型说明用途、特性与风险。' },
      { tag: '新增', text: '对局右侧「当前方块」面板：实时显示下落方块的图形、名称、旋转后尺寸与管道方向。' },
      { tag: '改进', text: '手机端旋转、保留按钮补上文字标签，与重开、暂停按钮保持一致。' },
      { tag: '改进', text: '新手教程改为先读后玩：关掉提示水流才启动，桌面端提示居中。' },
      { tag: '改进', text: '教程达成目标后自动进入下一步，不再需要点「下一步」；跳过只保留在教程首页。' },
      { tag: '修复', text: '最后一块落定后画面卡死（结算判定发生在操作内，界面没收到）：现在一定会给出结果卡。' },
      { tag: '修复', text: '教程步骤失败也会显示失败原因，并可以就地重试。' },
      { tag: '修复', text: '手机端 HUD 与触摸条不再压住棋盘。' },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-10-25',
    title: '手机操作与教练层',
    items: [
      { tag: '新增', text: '移动端触摸操作条：落块动作组 + 重开/暂停组，窄屏自动分两行。' },
      { tag: '新增', text: '新手教程 5 步教练层：围池、注水、排水、分流，纯谓词驱动，不写引擎。' },
      { tag: '改进', text: '管道与单向阀画出方向箭头，「沿箭头方向」终于看得见。' },
      { tag: '修复', text: '手机上没有任何重开按钮，且「暂停」被自身的点击立刻恢复。' },
      { tag: '修复', text: '三星块数按每关真实最少块数重设。' },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-23',
    title: '首个公开版本',
    items: [
      { tag: '新增', text: '100% 确定性水流模拟：同种子 + 同操作 = 逐位一致的状态哈希。' },
      { tag: '新增', text: '合同、每日挑战、无尽三种模式，本地最高分与三星记录。' },
      { tag: '新增', text: '回放与短码分享：完整操作流，可逐 tick 复现每一格横移与下落。' },
      { tag: '新增', text: '三步水流预览、保留槽与下一块预览。' },
      { tag: '新增', text: 'GitHub Pages 自动部署；纯单机，无后端、无网络请求。' },
    ],
  },
];

/** Newest entry — the one the menu badges as the current release. */
export function latestEntry(): ChangelogEntry | undefined {
  return CHANGELOG[0];
}

/** Look up one release, used by tests and by the panel header. */
export function entryFor(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((e) => e.version === version);
}

/** The release notes for the running build, if this build has any. */
export function notesForVersion(version: string): ChangelogEntry | undefined {
  return entryFor(version);
}
