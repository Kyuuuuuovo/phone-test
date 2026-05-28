# phone-app

纯前端 SPA 角色扮演手机 app。所有 JS 在浏览器执行,数据存 IndexedDB,AI 走用户自填的 OpenAI 兼容 endpoint。**作者不维护任何后端**。最终分发形态:GitHub Pages 静态托管。

---

## 当前状态(MVP-2 中 — 多 app 框架 + 钱包/收藏/行程/装饰位)

### 后端核心(`src/core/`)

- `db.js` —— IndexedDB 封装。`STORES` 常量是数据模型唯一来源。改动需 bump `DB_VERSION`。当前 `DB_VERSION = 15`。导出 `init / get / set / getAll / query(store, indexName, value) / del / clear / newId / updateSettings / txnPut(plan) / txnReplace(storeName, rows)`。`txnReplace` 是 `clear + put-many` 在同一 IDB tx 内,data-backup 导入用,避免半 store 数据。
- `util.js` —— 公共小工具。`esc(s)` HTML 转义、`dayKeyOf(ts)` 本地 `YYYY-MM-DD`、`parseTolerantJSON(raw, { expect })` LLM 输出容错解析。**关键改进**:`parseTolerantJSON` 用 stack-balanced 扫描代替 5 处旧文件里的 `match(/\[[\s\S]*\]/)` 贪婪正则 — 后者遇到模型在 JSON 之后追加带 `]` 的文字(`[注:see ref [1]]`)会扩到末尾炸 parse。新代码识别 `{` `}` `[` `]` 配对 + 字符串字面量保护,精确切到第一段完整 JSON 块。`expect: 'array' | 'object' | 'any'`(默认 array)。旧 copy(各 feature 文件里的本地 `esc` / `dayKeyOf`)按"碰到了再迁"策略,不一次性扫,避免 noise diff;新写代码直接 import。
- `pet.js` —— 桌宠模块。常量 `BEAR_PERSONA / AMBIENT_LINES`(作者锁定文案,普通用户改不到),保留 ID `BEAR_CHARACTER_ID = '__bear__'` / `BEAR_SESSION_ID = '__bear_session__'`;`ensureBearExists()` boot 时幂等保证两条 row 存在;`pickAmbientLine()` 按规则(无 API / 无角色 / lastMessageAt 老旧 / 时段)挑一条气泡文案,**不调 API**。聊天复用现有 chat 管线,不另起。
- `bottle.js` —— 漂流瓶核心。`scanDueBottles(db, ai)` 找 `replyDueAt <= now` 的 drifting 瓶子懒生成回信(boot + open app 时调用);`replyAsContact` / `replyAsStranger` 分两种受众生成回信(联系人模式注入"匿名"事实让角色不知道作者是谁);`fishBottle` 让 AI 现造陌生人 + 瓶子内容;`promoteStrangerToFriend` 把瓶子上的 `generatedPersona` 升格成正式 character。**所有 prompt 文案是 // TODO(作者填写) 占位**,Claude 不替作者定稿语气。
- `surveillance.js` —— 监控模块。`generateSnapshot(cameraId)` 拼专用 system prompt(persona + schedule + 最近聊天 + 房间 + angle + 模式事实 + 视角刚变动 hint)→ 严格 JSON schema(`{location, posture, activity, mood, caption, noticed}`)→ 写 `activityLog`,spy mode 且 noticed=true 时 flip `camera.discoveredAt`(铁律 9)。`proposeRooms(characterId, {excludeRoom})` 让 AI 给 3-4 个 ta 同意装/换机位的房间,prompt 里附"已装 N 台公开摄像头(房间:A、B)"上下文,允许 AI 返回 `[]` 表示 ta 拒绝再装。`proposeAngles(characterId, room)` 给 3-4 个合理镜头朝向(转动镜头流程的"AI 推荐"路径)。所有函数 `temperature: 0.4`。
- `context.js` —— `buildSystemPromptParts(sessionId)` 返回结构化分段数组 `[{key,title,body,kind,...}]`,`buildSystemPrompt(sessionId)` 把它 join 成最终字符串、`buildMessageHistory(sessionId, maxRecent=40)`、`maybeCompressMemory(sessionId, opts?)`(读 `settings.memoryEnabled / memoryThreshold`,默认 enabled + 30;**filter 掉 archived 后再算 overflow,按 dayKey 分组每次压最旧一天**;memory + 所有 archived msg 在一个 `db.txnPut` 里原子写)。`opts.force = true` 跳过 threshold buffer 检查,把"今天以外"的活跃消息按天分组压最旧一天(给 chat-info「立即提取记忆」按钮用)。**memory prompt V4 多卡** = `[CARD]标题/摘要/关键原话/标签/重要度[/CARD]` 块结构,一次压缩允许 1-3 张独立故事卡(`parseMemoryOutput` 返 array,无 [CARD] 标记的 V3 / V2 老数据自动 fallback 单卡);多卡共享 `groupId` 方便一起 undo;每张卡都独立 embed(故事粒度比单大段精准)。importance 只填 `high` / `low`,**两档都注入 prompt**(日常聊天大部分是 low,filter 掉就没记忆);importance 只影响记忆 app 显示(high 加 accent 边)。`formatMemoryWithDate(m, timeOn)` 注入时若 m.title 存在则拼 `[标题] summary` 前缀帮模型定位章节(quotes 不进 prompt — 给用户翻看的)。`normalizeMemorySummary(s)` export 给所有 render 端用,挽救 V2 时代存的 `{"summary":..."}` 字符串老数据。`buildMessageHistory` 的 `collapseAdjacentSameRole` 时间敏感:同 role 但间隔 > 5min 的消息合并时会插入 `[过了 N 分钟/小时/天]` 标记。prompt 第②层「当前状态」自动注入 `# 当前行程` / `# 当前打卡(用户)` / `# 生理状态(用户)` / `# 摄像头` / `# 角色当前活动` / `# 相关记忆(按语义检索)`。`HUMANIZER_PROMPT` / `BEHAVIOR_GUIDANCE` / `OUTPUT_COUNT_SPEC` / `ACTION_SCHEMAS_TEXT` 四段支持 settings 覆盖层。`buildScheduleLines(charId, sessionPersonaId, {userName, charName})` 已 export,surveillance.js 复用同一份。`buildCycleStatus()` 双门控(enabled + visibleToChat)+ 仅 in-period / fluctuation 才生成内容。
- `timeline.js` —— 时间线模块。**T31 多事件/天**:`generateMissingDays` 把一天的对话拆成 2-5 个独立事件(每行一个 ≤25 字),按 `eventIdx` 排序写多行 timeline row,共享 dayKey/fromTs/toTs。`splitTimelineEvents(raw)` 按 \n 拆 + 兼容老 prompt 的逗号串 fallback + 去前缀编号 + clamp 25 字。`mergeDays(sessionId, ids)` 合并多天后产出多事件 \n-join 的单行 summary(merged row 自身是聚合行,不写 eventIdx);`unmerge` 撤销。每 dayKey 只扫一次(任一 timeline row 存在就 skip),要刷新得删 timeline 行。`maybeCompressMemory` 末尾 fire-and-forget 调用,实现"每次总结自动更新 timeline"。**时间线不进 system prompt,只给用户翻看**。文案常量 `DEFAULT_TIMELINE_SYS` / `DEFAULT_TIMELINE_MERGE_SYS` 作者锁定。
- `cycle.js` —— 生理期 / 周期 共享逻辑。`computeCycleStatus(cfg, todayDk?)` 5 phase(`inactive` / `in-period` / `fluctuation` / `predicted` / `overdue`)+ `addDays / daysBetween / dayKeyToTs` 日期算术。放 core 是因为 features/cycle/cycle-app + cycle-notify + context 都要 import,放 features/ 会造反向依赖。
- `cycle-notify.js` —— boot 时检查一次 cycle status,在 `fluctuation` / `overdue` phase 且今天没发过通知就 fire OS Notification。dayKey dedup(`settings.cycleNotifiedDayKey`),同一天只发一次。复用 `settings.notifyOnReply` 全局通知 toggle。
- `form-helpers.js` —— `bindFormDirty(form, saveBtn, opts?)` 监听 form input/change,在 saveBtn 上 toggle `.saved` class + 文字「保存 / 已保存」。业务页保存成功后调 `dirty.markSaved()`,helper 自动监听后续改动翻回 dirty。不动 disabled,saved 状态点击仍能提交。已接入 API config / character / persona / 主题 / 设置-记忆 / 向量记忆 / 天气 7 页。
- `ai.js` —— `callAIOnce / callAI / requestReply` 三层。tool calling 支持 `get_current_time` / `get_weather` / `get_location`(按 chatSessions 的 toggle 启用)。`requestReply` 顶部有 `Map<sessionId, Promise>` in-flight 锁(防多 tab 共享 IDB 时并发触发记忆重复 archive),末尾调一次 `maybeCompressMemory`。
- `weather.js` —— 用户填 URL 模板 + key 的统一接口,响应原文 ≤1500 字传给 AI 自己解析(`PRESET_TEMPLATES` 是 3 个一键预设按钮)。
- `theme.js` —— 单一活动主题。`DEFAULT_THEME` / `FONT_OPTIONS` / `GLASS_OPTIONS` / `TEXTURE_OPTIONS` / `THEME_PRESETS`(内置 + 用户保存)。`applyTheme()` 把字段写成 `:root` CSS 变量 + `body.dataset.fx-*` 属性,所有页面联动。**`DEFAULT_THEME` 是黑白灰系**(#F4F4F5 / #1A1A1A / #3A3A3A accent / glass none)— 新用户 / clear-data 后看到的初始主题就这套;老用户的 settings.theme 已经写到 IDB 不变,要切回得手动选「黑白灰」preset。
- `modal.js` —— 通用页内 modal helper(`openModal(container, {title, fields, submitLabel})`),代替 `window.prompt()`。chat / wallet 都用。**field.kind 支持** `text` / `textarea` / `number` / `checkbox`(返回 true/false)/ `select`(takes `options: [{value, label}]`)。defaultValue 字段名是 `defaultValue` 不是 `default`(后者会被 form serialize 忽略)。
- `router.js` —— 页面栈。`setContainer / registerPage / navigate / back`。

### UI(`src/features/`)

- 全局壳:`.phone-frame` 用 `clamp(400px, calc((100vh - 24px) * 9 / 19.5), 480px)` 自适应桌面比例 + `align-items:center` 居中。状态栏:时间 + 4 根渐高竖线信号 SVG + 电池(`navigator.getBattery()`)。
- **首页 (`home`)** —— 2 页 + 4-槽 dock,统一 4×6 grid(unifiedGridV1):
  - 每页是 4 列 × 6 行的格子(`aspect-ratio: 2/3`),app 和 widget 共用 grid 位置 — 每个 item 存 `(row, col)`,widget 还存 `colSpan/rowSpan`;空 cell 无元素直接看到壁纸 (iOS 稀疏布局)。home.js 顶层常量 `ROWS=6 / COLS=4 / DOCK_SLOTS=4`。
  - 第 1 页:角色 / 世界书 / 人设 / 记忆 (app 默认 row=1);widget 也只在 page 0 显示 (widgets store 没有 page 字段,数据模型决定)
  - 第 2 页:行程 / 日记 / 推特 / 论坛 / 商城 / 监控 / 漂流瓶 / 千纸鹤 / 周期(生理期)
  - **Dock 是 4-slot grid** (settings.dockOrder = `[null, 'messaging', 'settings', null]` 默认两边空、中间 微信/设置),app 可双向拖 dock ↔ pages,widget 不进 dock
  - 编辑模式 (长按 / 右键进):顶上自动滑下 `.home-edit-toolbar`(左 + 添加装饰、右 完成),所有 item jiggle、× / ⚙ 显示、grid-slot dashed outline 显示。toolbar 平时 display:none 不占空间。
  - **拖拽规则**:同尺寸可换、不同尺寸需空位、拖到 .home-pages 左右 40px 边缘自动翻页 (B#5)、拖到 dock 区域自动切 surface (B#6)。widget cross-page / 进 dock / 超过 1×1 进 dock 一律 invalid (placeholder 红框 bounce)。
  - 加 widget: `findFirstFreeCell` 扫 4×6 找洞,真满了弹 openAlert 而不是溢出 (B#1)
  - 整页 `overflow-y: hidden`,grid 高度由 `aspect-ratio: 2/3` 锁死跟 home-page 宽度走
- **微信壳 (`messaging`)** —— 4 个底 tab:
  - **消息**(嵌入 chat-list,可右键弹菜单 置顶/拉黑/删除)
  - **通讯录**(按拼音排 + 首字母分组,collator probe;右上 + 走 openNewChatModal)
  - **朋友圈**(占位)
  - **我**(profile + 钱包余额 / 当前人设 / 收藏入口)
- **聊天页**:msg-row(头像 + 气泡组 + 已读标);时间分隔条(>5 分钟自动插);
  attach-panel(语音 / 图片 / 红包 / 转账 / 位置 — 都用 in-frame modal 收集输入);
  bubble menu(右键 / 长按 500ms):引用 / 复制 / 收藏 / 删除;**`reply` action 带 `quoteMsgId + quoteActionIdx`**(老数据无 quoteActionIdx fallback 0)— 引用多气泡消息中的特定一句靠 idx 精确定位;previewMap 用 `${msgId}:${idx}` 复合 key。
  **archive banner 视觉强化**:被压缩的 msg 折叠成 dashed-border accent 色 card,CTA「点开看被总结的 N 条聊天 / 收起这 N 条」,chevron 旋转 180° 表展开。
  **user-row 用 `padding-inline-start: 52px`** mirror char-row 的 avatar+gap 占位,防止长消息时 user bubble 左边界冲过对方头像那侧的对称位置(老 bug)。
  ⋯ 更多 → `chat-info`(置顶 / 显示已读 / 会话设置 / 聊天美化 / 记忆总结 / **立即提取记忆** / 编辑角色 / 清空 / 拉黑)。**立即提取记忆** = 调 `maybeCompressMemory(sid, {force:true})` 跳过 threshold buffer,把今天以外的活跃消息按天分组压最旧一天。
- **监控 (`monitor` / `monitor-view`)**:列表 + 单画面卡。添加机位三步 modal:选角色 → 选模式(光明正大 / 偷窥)→ 选房间(光明正大走 `proposeRooms`,偷窥用户自填)。画面是 CCTV 风格深灰卡 + 噪点 overlay + saturate/hue 滤镜,显示 location/posture/activity/mood/caption + 红点 REC + 时间戳。spy 被察觉后顶部红条 + camera.discoveredAt 写入。快照式:刷新 = 一次 API 调用 = 一帧。
- 已注册路由 (~40 个):
  - `home / settings / settings-api / settings-api-detail / settings-weather / settings-theme / settings-memory / settings-embedding / settings-data / settings-clear / settings-app-icons / settings-widget-presets`
  - `messaging / chat-list / chat / chat-info / chat-beautify / chat-settings / memory-manage / prompt-inspector`
  - `character-list / character-detail / worldbook-list / worldbook-detail / persona-list / persona-detail / persona-pick`
  - `wallet / favorites-list / schedule / monitor / monitor-view / bottle / memory / keepsake / cycle`
- **DevMode + 提示词调试 (`prompt-inspector`)**:设置 → 调试 → 开发者模式 打开后,聊天页右上角多一个齿轮 icon,跳到调试面板。面板:(a) 列出所有 apiConfig,radio 切活跃配置,**下一轮回复立刻用新配置,不需要刷新**;(b) 按真实注入顺序列出所有 prompt 分段(`buildSystemPromptParts`),每段显示 kind 标签(计算 / 数据 / 源常量 / 已覆盖)+ 是否「未注入」+ 警告(如改 OUTPUT 两段会破坏 JSON 契约);(c) override 段(humanizer / behavior / countSpec / schemasText)有「编辑」「保存」「恢复默认」,空字符串覆盖保留为「故意不注入」;(d) data 段有「去编辑 →」跳对应页;(e) 「显示完整 dump」原样输出 `buildSystemPrompt` 最终字符串。终端用户 devMode 默认关,看不见入口。
- **桌宠**:全局悬浮球,挂在 `.phone-frame` 内、`#page-container` **兄弟节点**(跨页常驻,不走 router)。交互三档:**短点 = 冒一条氛围气泡**(强制 fresh,绕过冷却);**长按 (touch/pen 600ms) / 右键 = 进 `chat` sessionId=`__bear_session__`**;>4px 拖动 = 持久化新坐标。氛围气泡按规则(无 API / 无角色 / lastMessageAt 老旧 / 时段)挑文案,**不调 API**。位置 / 开关 / 气泡冷却进 `settings`。`__bear__` 在 character-list / contacts / 新建对话 modal / monitor 选角色 / 行程选角色 等所有"选角色"界面都被过滤(`c.id !== '__bear__'`),编辑入口只在 设置 → 桌宠 → 编辑桌宠人设(跳 `character-detail`)。
- **漂流瓶 (`bottle`)**:网络隐喻(不是物理瓶子,UI 文案避开"海里/捞/漂着"),保留 audience 二选一,一瓶一回。两种受众模式:**contacts** = 从非内置非拉黑 character 里随机挑一个回信,注入 `ANONYMITY_FRAMING_FOR_CONTACTS` 让 ta 不知道作者是谁;**strangers** = 用 `STRANGER_PERSONA_GENERATOR_SYS` 现造一个网络上的陌生人(任何国家时区/年龄/身份/心情 — 强调多样性,不要默认温柔好人)再让 ta 回。发时只存 row(`status='drifting'`、`replyDueAt = now + 30min-4h 随机`);boot + 打开 app 时 `scanDueBottles` 找到期 drifting → 懒生成回信(**模块级 `_scanning` 锁防 boot+app-open 并发**)。"随机收一条" = AI 现造陌生人 + 写一封瓶子。回信 / 发的人支持「加好友」一键升格成正式 character。回信是**纯文本**,不走动作协议,不进 chatMessages —— 单独存在 `bottles` store。
- **独立记忆 app (`memory`,home 第二页入口)**:跨会话的记忆总览,4 tab:**月历**(当月格子 + 时间线/总结/纪念日三色点 + 点格子看当天细节 modal + 「加纪念日」直达)/ **时间线**(跨会话的一句话日总结 + 会话标签)/ **纪念日**(`milestones` store,可关联角色 + 每年重复)/ **总结**(跨会话 L1/L2 memories,按会话折叠分组)。不进 system prompt,纯用户视图。**chat 内的 memory-manage 还在**(session-scoped 操作 — 删 summary / 风格 override / 时间线 tab + merge / 导出文本),两者并存。
- **向量记忆 (设置 → 向量记忆 / `settings-embedding`)**:OpenAI 兼容 `/v1/embeddings` 端点。配置后:每条 memory 生成时 fire-and-forget embed → 存 `embeddings` store(`Float32Array`,IDB 原生 structured-clone)。每次 `requestReply` 把最近 5 turns(user + assistant 混合)拼成 query → cosine top-K(**阈值 ≥ 0.35**,默认 K=5)→ 注入 prompt 的「# 相关记忆(按语义检索)」段,位置在「# 远期记忆」之前。3 个预设按钮(OpenAI / 硅基流动 BGE / DashScope Qwen)。「补齐旧总结」按钮串行 + 150ms 间隔,不会撞速率限制。默认关 — 每轮回复多 1 次 embedding API 调用,opt-in。
- **modal helpers (`src/core/modal.js`)**:`openModal({title,fields,...})` Promise<obj|null>(收输入)、`openConfirm({title,message,danger?})` Promise<bool>(确认)、`openAlert({title,message,danger?})` Promise<void>(单按钮提示)。**全部页内 modal,不要再用 `confirm()` / `alert()`**(已经把项目里所有 22+24 处全替换了)。Esc/Enter/click-outside 都处理了。`danger:true` 把按钮/标题染红。
- **生理期 / 周期 app (`cycle`)**:home 第 2 页入口(月相 SVG)。3 tab:**当前**(状态卡 + 主操作「记今天为开始 / 结束」+ 信息列表) / **日历**(月历 + 实际 in-period 主色块 + 预测窗口淡色 + 预计开始日 dashed)/ **症状**(列表 + 加症状 modal — cramp/headache/mood/flow/note 5 类)。设置(齿轮 icon)走 openModal:enabled / visibleToChat / averageLength / periodLength / fluctuation。EMA 学习:每次记开始按 70%/30% 把实际周期合到 averageLength,记结束更新 periodLength。**默认隐私安全**:enabled + visibleToChat 双门控,默认都关 — user 主动开两个才让 AI 看到。prompt 只在 `in-period` / `fluctuation` 时生成事实陈述(铁律 3,无行为引导),其它 phase return ''。OS 通知在 `fluctuation` / `overdue` 当天发一次,dayKey dedup。
- **widget 风格预设 (`settings-widget-presets`)**:设置 → widget 风格。6 个内置 preset(默认 / 极简 / 拟物 / 柔和粉 / 深色玻璃 / Y2K 蓝)+ user 自定义。点 chip → confirm → batch 覆盖所有 widget 的 bgColor/radius/transparency/tilt。「+ 自定义」dashed card 在 grid 末尾,弹 modal 让 user 调 HSV/radius/transparency/tilt + 起名,保存到 `settings.widgetPresets[]`。用户自定义的 chip 上 hover / 触屏永显 × 删除。modal 内复用 home.js 的 field helpers(`bgColorAndRadiusFieldsHtml` / `transparencyFieldHtml` / `tiltFieldHtml`,都 export 了)。
- **保存按钮 dirty 反馈**:7 个 settings/edit 页接入了 `bindFormDirty(form, saveBtn)` — 初始「已保存」灰扁化、改任意字段「保存」恢复亮色、点保存后变回灰。saveBtn 不被 disabled,saved 态点击仍能提交,只是视觉反馈"这一轮改完保存了不用再点"。主题编辑页用法略不同(no form, manual `dirty/syncSaveBtnState`)— 因为 theme 编辑器有 tab + 重 render,save-btn 每次 render 都重建,需要手动 sync class 状态。

---

## 数据模型(`db.js` STORES,DB_VERSION = 15)

| store | 主键 | 索引 | 说明 |
|---|---|---|---|
| `characters` | `id` | — | 角色,字段 name / persona / avatar / notes / blocked / **chatBackground**(per-character 聊天背景 base64)/ **chatFontSize**(per-character 字号覆盖,null 表示跟随全局)/ createdAt / updatedAt |
| `worldbooks` | `id` | — | 世界书容器(只有元数据) |
| `worldbookEntries` | `id` | worldbookId | 条目,字段 title / content / enabled / `position` / `keywords?` / createdAt。`position` 三档:`before`(角色设定前)/ `inline`(角色设定后,默认)/ `after`(用户人设后)。**title 只是用户索引,不进 prompt;只 content 会被注入。** 同 position 内按 createdAt 升序排。`keywords` 是 string[](逗号分隔输入,UI parse 成 array):空 / undefined = 一直注入(向后兼容);有值 = 只在最近 10 条聊天消息任一里出现其中一个 keyword 时才注入(SillyTavern lorebook 风格,大小写不敏感 + substring 匹配) |
| `characterWorldbooks` | `id` | characterId, worldbookId | 多对多关系表,字段 priority |
| `personas` | `id` | — | 玩家人设库,字段 name / persona / signature / avatar / `statusText?` / `statusSetAt?` / createdAt。**statusText 一字段两入口**:微信「我」tab 状态卡 + persona 详情页都能编辑、读同一份。statusSetAt 只在 statusText 实际变化时 bump(避免每次保存 persona 都 reset 时间) |
| `chatSessions` | `id` | characterId, lastMessageAt | 字段 characterId / personaId / title / createdAt / lastMessageAt / **isPinned** / `showReadReceipts`(默认 true)/ `readReceiptUpToTs` / `memoryPromptOverride`;会话感知 toggle:`{char,user}TzEnabled` / `*WeatherEnabled` / `*LocEnabled` + `*CityMode` / `*CityKey` / `*CityLabel` |
| `chatMessages` | `id` | sessionId, createdAt | role(`user`/`character`/`system`)/ **actions[]** / createdAt |
| `memories` | `id` | sessionId | 长对话压缩摘要,字段 sessionId / `tier`(1=近期 L1 / 2=远期 L2) / `title?` / summary / `quotes?: string[]`(关键原话,格式 `"说话人→对方: 内容"`)/ `events?: string[]`(「这次发生了」事件链,手机原生 actions 自动扫出 plain 文字 chip)/ `tag?`(6 类:转折/亲密/冲突/发现/约定/日常)/ `importance?`(`'high' \| 'low'`,默认 low) / `groupId?`(V4 多卡一次压缩共享) / fromMsgId / toMsgId / `fromTs` / `toTs` / createdAt。**V4 多卡**:一次压缩可产出 1-3 张独立故事卡,共享 groupId;`title` / `quotes` / `events` / `importance` 都可空(老数据没有,渲染端兜底)。**events 只挂第一张卡**(避免多卡同一 overflow 范围重复显示)。**importance 两档都注入 prompt**,只影响记忆 app 显示(high 加 accent 边)。events 不进 prompt(已在 summary 里覆盖)。**L2 删 L1 时同时清对应 embeddings 行**(否则 vector 表有孤儿)。**summary 字段渲染前要走 `normalizeMemorySummary()`** — 挽救 V2 时代存的 JSON 字符串老数据 |
| `apiConfig` | `id` | — | 多条;每条 id / name / apiUrl / apiKey / modelName / temperature / maxTokens?。当前活跃由 `settings.activeApiConfigId` 指。**temperature input `step="0.001"`** 支持 3 位小数(0.75 / 0.123 等) |
| `settings` | `id` | — | 单例 id=`default`。字段:`theme`(对象,见 [core/theme.js](src/core/theme.js),DEFAULT_THEME 是黑白灰系)/ `themePresets[]` / `widgetPresets[]`(user 自定义 widget 风格预设,每项 `{id, label, hint, sample:{bg,radius}, override:{bgColor,radius,transparency,tilt}}`)/ `wallpaper`(base64 桌面壁纸)/ `appIconOverrides: {[appId]: {kind: 'emoji'\|'text'\|'image'\|'url', value}}` / `activeApiConfigId` / `activePersonaId`(新建会话用)/ `weatherApi: {urlTemplate, apiKey}` / `memoryEnabled`(默认 true)/ `memoryThreshold`(默认 30,**缓冲条数** — 留多少条活跃不压;**T17 后新规则按 dayKey 分组每次压最旧一天,不再有"一次压几条"概念**)/ `memoryBatchSize`(**已废弃**,老 settings 留着不读)/ `petEnabled`(默认 true)/ `petX` / `petY` / `petLastBubbleAt` / `petDismissed: {triggerKey: ts}`(气泡冷却记录)/ `notifyOnReply`(全局通知 toggle,行程提醒 / 生理期提醒共用)/ `scheduleNotifiedIds[]`(行程通知 dedup,cap 50)/ `cycleNotifiedDayKey`(周期通知 dayKey 级 dedup,同一天只发一次)/ **`tileOrder`** / **`dockOrder`**(home 布局,见 home 段)/ `syncScheduleToChat`(默认 true)/ `syncMonitorToChat`(默认 false,opt-in)/ `devMode`(默认 false)/ `promptOverrides` / `promptOutputOverrides`(prompt 覆盖层)/ `embedding: {urlTemplate?, apiKey?, modelName?, enabled?, topK?, worldbookThreshold?}` / `memoryStyle`(`'default' \| 'planner' \| 'cabinet' \| 'petal' \| 'film' \| 'cosmic'`,默认 `'planner'`)/ `favoritesMigratedV1` / `unifiedGridV1`(home 一次性迁移 flag)。**所有 settings 修改用 `db.updateSettings(fn)` 原子化**,不要再 `get → 改 → set` 三连。`humanizerPrompt` 字段已废弃,在 `src/core/humanizer.js` 常量里 |
| `wallet` | `id` | — | 单例 id=`default`,字段 balance。用户发红包/转账扣余额,领 AI 红包/转账加余额。充值在「我 → 钱包」 |
| `favorites` | `id` | sessionId, savedAt | 收藏的消息条目,字段 sessionId / msgId / actionIdx / savedAt / note。bubble menu「收藏」存入这里,「我 → 收藏」浏览 |
| `schedule` | `id` | startTs, characterId | 行程条目,字段 who(`user`/`character`)/ characterId(who=character 时)/ startTs / endTs / title / desc / `syncToChat`(默认 true,可关掉单条不注入)/ createdAt。在 [now-3d, now+3d] 窗内被注入 system prompt 的「# 当前行程」段;受 `settings.syncScheduleToChat` 全局开关 + 单条 `syncToChat` 双重门控 |
| `checkinTypes` | `id` | — | 打卡类型定义。字段 name / icon / color / `reminder?` / createdAt。**`targetFreq` 字段已废弃**(T6 删 streak / 目标频率维度,打卡纯记录不做 habit 追踪;老数据字段保留但不渲染)。在 schedule app 顶部 ✓ 按钮 → 管理 modal 里 CRUD。通常 < 20 条,无索引全表扫 |
| `checkins` | `id` | typeId, dayKey | 每次打卡一行。字段 typeId / dayKey(`YYYY-MM-DD`)/ checkedAt / `note?` / `value?`(预留「次数 / 分钟」)。同 (typeId, dayKey) 业务层 upsert(IDB 不约束)。月历视图按 dayKey index 范围扫,O(month)。删除 type 时级联清相关 checkin 行(`openManageTypesModal` 的 del handler 干这事) |
| `homeWidgets` | `id` | createdAt | 用户添加的桌面装饰,字段 type(`favorites`/`image`/`note`/`polaroid`/`anniversary`/`music`)/ data(base64 或文本或对象,按 type)/ **row / col / colSpan / rowSpan**(unifiedGridV1 后的位置,inline `grid-column / grid-row` 渲染)/ `transparency?`(0-100,默认 100,渲染为 `--widget-alpha`)/ createdAt。**只在 page 0 显示**(数据模型没 page 字段)。**legacy `size / placement / order` 字段** migration 跑过后已转成 row/col + widgetSpan,但 `widgetSpan()` 里仍有按 type 兜底分支防御老数据 |
| `cameras` | `id` | characterId | 监控机位,字段 characterId / room / `angle?`(可选,镜头朝向描述) / mode(`open`/`spy`) / `feedToChat`(默认 false,可单台开同步) / createdAt / `discoveredAt`(spy 被察觉时写入,null 表示未被察觉)/ `viewChangedAt?`(换机位或转动镜头时写入,monitor-view 渲染时过滤 createdAt < 这个值的旧 activityLog,数据保留但 UI 隐藏)。feedToChat 开 + `settings.syncMonitorToChat` 全局开 → 该角色最近一条 activityLog 注入 system prompt 的「# 角色当前活动」段(纯第一人称事实陈述,不提镜头 — 铁律 9) |
| `activityLog` | `id` | cameraId, characterId | 监控快照历史,字段 cameraId / characterId / sessionId? / `payload: {location, posture, activity, mood, caption, noticed, outOfReach?}` / createdAt。每次刷新画面 append 一条,**每台机位只保留最近 50 条**(`ACTIVITY_LOG_KEEP` in surveillance.js),写一条 prune 一次,IDB 不会无限涨 |
| `bottles` | `id` | status, castAt | 漂流瓶(网络隐喻,不是物理瓶子),字段 content / authorIsUser / audience(`contacts`/`strangers`) / status(`drifting`/`replied`/`read`) / replierCharacterId?(contacts 模式回信的角色 id) / generatedPersona?({name,persona,vibe,avatar?})(strangers 模式现造的人格) / reply? / castAt / replyDueAt? / repliedAt? / promotedCharacterId?。一瓶一回,要续聊走 `promoteStrangerToFriend` 升格成正式 character |
| `timeline` | `id` | sessionId | 每会话**每事件**一行(用户翻看用,**不进 system prompt**)。字段 sessionId / dayKey(`YYYY-MM-DD` 或 `start~end` 合并行) / summary(单事件 ≤25 字;merged 行用 `\n` 拼多事件) / `eventIdx?`(同 dayKey 内排序,0-based;merged 行没有这字段) / `fromTs?` / `toTs?`(整天时间窗) / `mergedFrom?[]` / `mergedInto?` / createdAt。**T31 多事件/天**:一次扫描把一天拆成 2-5 个独立事件多行写入,共享 dayKey/fromTs/toTs。每 dayKey 任一行存在就 skip(防重复) — 要刷新得删 timeline 行 |
| `milestones` | `id` | dayKey, characterId | 用户手动标的纪念日。字段 dayKey(`YYYY-MM-DD`) / title / desc? / `recurring?`(每年同月日高亮) / characterId?(关联角色)/ createdAt。挂在独立「记忆 app」里(home 第二页),不进 system prompt,只用于月历视图 + 列表 |
| `embeddings` | `id` | sessionId, sourceId | 向量记忆。字段 sourceType(`memory`/`msg`/`worldbook-entry`) / sourceId / sessionId / vector(`Float32Array`,IDB 直接 structured-clone 存原生数组) / dim / modelName / createdAt。每条 memory 生成时 fire-and-forget embed 一次,`requestReply` 时把最近 5 条对话拼成 query → cosine top-K(阈值 ≥ 0.35,默认 K=5)→ 注入 system prompt 的「# 相关记忆(按语义检索)」段。默认关,在 设置 → 向量记忆 启用 |
| `keepsakes` | `id` | characterId, status | 千纸鹤 / 叠星星 — 关系信物,字段 characterId / type(`crane`/`star`) / theme / status(`folded`/`opened`/`kept`) / content? / nth / total / createdAt / openedAt?。lazy 生成:user 出题 → N 行 folded 不调 API;拆 → ai.callAI 生成 content → opened。`KEEPSAKE_SYS_TEMPLATE` 是作者占位 TODO |
| `userProfiles` | `id` | characterId | per (角色×人设) 的"角色眼中的 ta"画像。id = composite `${charId}\|${personaId}`(personaId 空 = 共享)。字段 characterId / personaId / likes / dislikes / discoveries / createdAt / updatedAt。lookup 先精确 charId\|sessionPersonaId 再 fallback charId\| |
| `cycle` | `id` | — | **新加,DB_VERSION 13**。生理期 单例 id=`default`。字段 enabled(默认 false)/ visibleToChat(默认 false,prompt 注入开关)/ averageLength(默认 28)/ periodLength(默认 5)/ fluctuation(默认 ±2 天)/ lastStartDayKey / history[{startDayKey, endDayKey?, note?}]。**双门控**:enabled + visibleToChat 都开 prompt 才注入(隐私敏感)。预测算法 `core/cycle.js#computeCycleStatus` |
| `cycleSymptoms` | `id` | dayKey | **新加,DB_VERSION 13**。生理期症状记录(独立 store,跟 checkins 隔离 — 隐私 + 数据形状不同)。字段 id / dayKey(`YYYY-MM-DD`) / kind(`cramp`/`headache`/`mood`/`flow`/`note`) / severity?(1-3) / note? / createdAt |

---

## 动作协议 v2

模型 system prompt 强制要求**只返回 JSON 数组**(`OUTPUT_COUNT_SPEC` + `ACTION_SCHEMAS_TEXT` in `context.js`),每项是 `{type, ...}`。允许的 type:

- `text { content }`
- `reply { content, quoteMsgId }`
- `recall { targetMsgId? }`
- `image { description }` —— 用户上传时也可以 `src`
- `voice { content, duration? }` —— 「文字内容 + UI 渲染成语音条」,不做真 TTS。点击气泡展开文字
- `unblock_request { content }` —— **受控动作**,只能请求,用户点同意才生效
- `red_packet { amount, message?, claimed?, claimedAt? }` —— 微信式宽矮卡片,点击整张卡领取
- `transfer { amount, message?, accepted?, claimedAt? }` —— 类红包,蓝色卡片
- `location { name, desc? }` —— 地点卡片,纯展示

**数量约束**:1-5 条。**绝不在 prompt 里写行为引导**(见下面铁律 3)。

**红包/转账钱包联动**:用户发出 → 扣 `wallet.balance`(不足阻止);用户领 AI 发的 → 加 `wallet.balance`。在 `chat.js` 的 `tryDeductWallet` / `creditWallet` 实现。

未来动作:sticker / call / state(心理活动/好感度) / poke ...

---

## 关键设计决策(已敲定,别擅自动)

1. **架构铁律**:无后端、key 在用户浏览器、数据在 IndexedDB。分发走 GitHub Pages。
2. **「积攒后触发」**:用户发的消息**立刻入 DB,不调 API**。底部「让 AI 回复」按钮才触发 `ai.requestReply(sessionId)`。所以 API 一次能看到多条用户消息。
3. **system prompt 不加行为引导**——「不要话痨」「沉默也是一种回应」「避免无意义复读」这种**绝对不写**。角色行为完全交给 `character.persona`。骨架只管格式 + 数量。
4. **动作协议 = 骨架契约**:加新动作 = 加 type + 可选 handler。`dispatchActions` 对未知 type no-op,所以 UI 不依赖 handler 是否注册。
5. **chat history 双形态**:`assistant` 消息原样回显 JSON 数组(强化输出格式),`user` 消息渲染成自然文本。
6. **加号是「推上来」的面板**,不是悬浮 popup(微信式 UX)。和 `.chat-input` 是 flex 兄弟,展开时挤短消息流。
7. **置顶视觉用底色(`--bg-pinned`),不用 emoji 标记**。
8. **iOS 刘海外壳 + 多主题切换** —— 框架已预留(主题 CSS 变量都在 `:root`,phone-frame 居中、可扩展刘海)。UI 细节暂缓。
9. **「状态 = 情景陈述,不是功能开关」**:像 `character.blocked` 这种世界状态,**不**在前端直接禁掉某些功能(比如禁用 AI 回复按钮)。而是把布尔位翻译成一段**事实陈述**塞进 system prompt(「你目前已被对方加入黑名单」),让模型按 `character.persona` 自己决定怎么演。AI 想反向改变状态(比如请求加回)必须走一个明确动作类型(`unblock_request`),前端把它渲染成需要用户点击同意的特殊气泡 —— 状态改变权始终在用户手里。这是铁律 3 的延伸:陈述事实 ≠ 行为引导。
10. **「app 元约束 ≠ 角色行为引导」**:铁律 3 禁的是**给某个具体角色塞固化的行为引导**(那是 `character.persona` 该写的)。但**全局对话规范**和**全局动作使用规约**——「这是个聊天 app 模拟器,要像真人打字」/「`transfer` 动作适用于钱款往来语境」——属于 app 范式层、跟具体演谁无关,**不算违反铁律 3**。它们分别存在两个**作者锁定**(普通用户看不到也改不到)的常量:
    - `src/core/humanizer.js` 的 `HUMANIZER_PROMPT` → 「# 对话规范」段(关于语气 / 节奏 / 禁词)
    - `src/core/behavior.js` 的 `BEHAVIOR_GUIDANCE` → 「# 动作使用规约」段(关于**什么时机用哪个动作**)
    
    **边界**:`BEHAVIOR_GUIDANCE` 内容必须是「动作语境说明」(`transfer 用于钱款往来语境`,中性、客观),**不能滑成「角色行为指令」**(`你应该在角色心软时主动转账`,这是铁律 3 禁的)。两个常量都被 `context.buildSystemPrompt` 顺序注入(对话规范 → 动作使用规约 → featureContext → 输出数量 → 动作定义表)。空字符串就不注入。将来朋友圈 / 日记 / 论坛等场景的 prompt 拼装函数也 `import` 这两个常量。**内容由作者书写,Claude 不代笔**。

11. **AI 主动动作三处对齐**:加一个 AI 能主动触发的新动作(如 `transfer` / `red_packet` / 未来的 `sticker` / `call` 等)必须**三处对齐**——
    1. **介绍** —— `OUTPUT_FORMAT_SPEC` / `ACTION_SCHEMAS_TEXT` 加 JSON schema 描述;若该动作有"什么时机用"的语境说明,`behavior.js` 的 `BEHAVIOR_GUIDANCE` 里加(中性,不是行为引导)
    2. **实现** —— `chat.js` 的 attach panel handler 或 `ai.js` 的 dispatch 处理副作用;若是受控动作还要加状态字段(如 `claimed/accepted`);`context.js` 的 `renderActionsAsText` 把它转成模型能看懂的文本(给 history);`chat-list.js` 的 `previewOfMessage` 给一行预览
    3. **渲染** —— `chat.js` 的 `renderAction` switch 加 case 画气泡 UI,含交互态(按钮 / 已领标记 / 等)
    
    **Why**:三处不对齐会产生死动作 —— prompt 教 AI 输出但前端不画,或前端画了但 AI 不知道何时用。这个项目里所有 9 个动作都遵循这个模式。**用户说"加一个新动作"或"加一个 AI 也能用的功能"时,先列出三处分别要改什么,再动手。漏掉任何一处都是不完整实现。**

12. **三处一致的「环境上下文」**:天气/日程/监控/角色当前状态都是同类,**数据产生**(各有时机)**→ 存 IndexedDB → 发消息时按窗口/相关性挑出来转文本 → 塞 system prompt 第②层「当前状态」**。已实现的 `# 当前行程`(`buildScheduleLines`)是模板。**注意**:天气保留 `get_weather` 工具调用方式(AI 主动拉,省 token 不复读);日程/监控这种结构化、明确事件适合主动注入。**轻提示要放 `BEHAVIOR_GUIDANCE` 全局,不能塞单个角色 prompt 段**(铁律 3)。**世界状态(角色睡了/出门了)不进 `chatMessages`** —— 它该有自己的 store,渲染时按时间穿插显示,跟通讯记录分开。

---

## 路线图

### 已完成 (备忘 + 看代码哪个版本做的对应 git tag)
**Home / Widget 系统**
- ✅ 桌面装饰拖拽重排 — `homeWidgets` 改 row/col/colSpan/rowSpan 自由定位 (unifiedGridV1)
- ✅ 首页 app-icon 排序 + 跨页拖 — `settings.tileOrder[]`,edge 自动 scroll
- ✅ Dock 可拖 — 4-slot grid + `settings.dockOrder`,app 双向拖 dock↔pages
- ✅ 加 widget 不溢出 — `findFirstFreeCell` 扫 4×5 找洞,真满了 openAlert
- ✅ 拖拽几何缓存 — dragStart 算一次 `gridGeometry`,onPointerMove 复用
- ✅ snapshotItems 数据驱动 — 从 pageItemsList 查,不靠正则解析 inline style
- ✅ 长按阈值调宽 + 横向占主导立刻 cancel — 8→20px,不误触发 edit
- ✅ 编辑 toolbar — `.home-edit-toolbar`,左 + 添加装饰、右 完成,只 editing 显示
- ✅ 5 行 grid + 手机 viewport 撑满 — 桌面 aspect 4/5 严格正方;`@media (max-width:440)` drop aspect-ratio 用 flex:1 让 grid 填满
- ✅ migration 清 stale row > 4 — 6 行实验后回退残留数据
- ✅ 跨页拖 app 回加 + scroll restore — `_restoreScrollToPage` re-mount 后 scrollTo
- ✅ widget 编辑 SVG 图标 — ⚙/× emoji 改 SVG + flex 居中
- ✅ image widget 可换图 / polaroid widget 可换照片 (3 槽)
- ✅ anniversary widget milestone 模式 + 大于 365 天显黎年
- ✅ Phase B widget HSV 色 + 圆角 自定义 — 每个 editor 加 HSV 三滑条 + radius + 「自定义」toggle,bgColor / radius 写 `--widget-bg / --widget-radius` CSS var
- ✅ widget 宽×高自由选 — 宽 1-4 / 高 1-5 两 dropdown 代替 5 固定预设

**主题 / 外观**
- ✅ 黑白灰主题 preset (mono)
- ✅ 主题 preset 点击不再 re-render(避免触屏 :hover 错位)
- ✅ mini preview 始终显示壁纸 — surface 加 margin
- ✅ 刘海 ::before → ::after,base ::before 的 backdrop 保留(non-home wallpaper 不再透出)
- ✅ 设置页分两段 — 基础(API/外观/记忆/数据/清空) + 扩展(天气/向量)

**Chat**
- ✅ 横向 + 纵向 scroll 锁,100vh→100dvh,iOS Safari URL bar 不再让 body 比可见区高
- ✅ 触屏 :hover 粘住修复 — `@media (hover: hover)` 包 widget edit/del button
- ✅ 通讯录拼音排序 — Chinese 哨兵代替 Latin A-Z 做 collator probe
- ✅ 引用消息注入完整原文 — `makeRenderContext.resolveQuote`,reply case 拼 `[引用「原文」]\n回复`
- ✅ 已读标志改用户气泡左侧 + 紧贴气泡
- ✅ 删/复制按 action 粒度 — `activeBubbleActionIdx` 记下用户长按的具体气泡,handler 用它而不是 querySelector 第一个
- ✅ 长按 regenerate 弹 hint modal — `regenHint` 注入 `# 本次重新生成的要求` 段,只此一次不进 history
- ✅ 调试面板 3 tab(API / 分段 / 完整)+ 分段按 group 归类(世界观/记忆/状态/规范/输出)
- ✅ iOS 输入框 zoom 残留 — input/textarea/select 强制 font-size: max(16px, 1rem)
- ✅ 复制 bubble 真正修(actionIdx 来源 querySelector 永远 0 的 bug)
- ✅ 微信「我」tab 加号隐藏 + 头像可点换图(写 persona.avatar)

**世界 / 时间 / 记忆**
- ✅ 阶段 0 worldMode 'real'/'fictional' — per character 起步,后挪到 per session;架空模式 skip current-time / cameras / activity 段 + 不暴露 weather/location 工具
- ✅ 阶段 1a 稀疏时间标记 — `collapseAdjacentSameRole` 加跨 role gap >30min 标记,memories 加 `fromTs/toTs`,注入前缀【M月D日】或【M月D日–M月D日】
- ✅ A 时间感知 toggle in chat-info(session.timeAwareness 'on'/'off',off 时不插 gap 不前缀日期)
- ✅ 1b 用户行程 visibleTo — schedule.visibleTo,默认 undefined=所有可见,[]=全私,['c1']=只对列出的

**通知 / 行程**
- ✅ 行程 banner ⏰ emoji → SVG 铃铛
- ✅ 行程提醒联动系统通知 — `fireOsNotification`,hidden 时走 Notification API,复用 `settings.notifyOnReply` 开关

**批 ABCD(本轮 11 件清空)**
- ✅ A1 行程 widget — `renderScheduleWidget`,窗口 [now-30min, now+24h],空态 + 列表
- ✅ A2 游戏机 widget — Game Boy 致敬 SVG,纯装饰(`widget-gameboy`)
- ✅ A3 便签竖排选项 — note widget 加 `vertical` 字段,渲染 `writing-mode: vertical-rl`
- ✅ A4 拍立得编辑按钮重叠修复 — `.widget-polaroid .widget-edit/del z-index: 10` 盖过 stack photo
- ✅ A5 图片/拍立得合并一类 — `photo` 入口统一,提交按张数分发 image / polaroid
- ✅ B1 widget 编辑入口提示 — `@media (hover: none)` 给触屏加永久 5px hint dot
- ✅ B2 app/widget 点击动效统一 — widget 加 `:active scale(0.97)`,跟 app-icon 一致
- ✅ B3 + 新页 + 空页自动回收 — `effectivePageCount` 动态;edit toolbar 「+ 新页」按钮;mount 时尾部空页 prune;**顺手修了 resolveTilesForPage 跨页拖的 duplicate bug**(byId 改成全 PAGES + DOCK_CATALOG;remaining 排除 usedAcrossAll)
- ✅ C1 拍照模式 + 真实图片上传 — attach panel 加「拍照」(走 description)、「图片」改成 file picker → `actions[].src`;`renderActionsAsText` 给 src 走占位文字防爆 token
- ✅ C2 tokens 预估 — chat header devMode 加 `.token-badge`,中文 ≈1.5/字、ASCII ≈0.3/char 粗估
- ✅ D1 app 图标更换 — edit mode app-icon 角标 ⚙ → `openIconPicker`(12 个预设 emoji + 上传图片 + 恢复默认),override 写 `settings.appIconOverrides[appId]`,`tileHtml` 接受 override 渲染
- ✅ 修 widget 越界压缩 grid 5 行布局 — CSS `grid-auto-rows: 0`(越界 widget 折叠,主 grid 保持 5 行);mountHome idempotent re-clamp;`updateWidget` 改 rowSpan/colSpan 后 clamp,冲突走 findFirstFreeCell。**根因**:user 把 widget 的 rowSpan 改大但 row 没动 → grid-row 越界 5 行 → `grid-auto-rows: minmax(0,1fr)` 创建第 6+ 行 1fr 等分,所有 cells 被挤扁
- ✅ widget 倾斜角度 — 所有 editor 加 -30°~30° slider,`gridStyle` 注入 `--widget-tilt`,CSS `transform: rotate(var(--widget-tilt, 0deg))`;`:active scale` 拼到一起;dragging 时归零方便看落点
- ✅ MP3 widget(`renderMp3Widget`)— iPod 致敬 SVG,跟 gameboy 一样走 `askSizeAndTransparency`

**本轮 batch(28 件清空)**

*第一阶段 — UI polish*
- ✅ + 新页按钮 bug 修(刚 push 的空页被立刻 prune;cleanup 清 flag 导致 navigate('home') 链丢 preserveEditModeOnMount → cleanup 不清,mountHome 头部 read-and-clear)
- ✅ 照片 editor 加展示形式下拉(image/polaroid 二选一,不再按张数自动判断)
- ✅ + 新页挪到「完成」左侧(toolbar `.page-add { margin-left: auto }`)
- ✅ favicon(手机蓝屏 SVG data URI)+ 开屏 splash(iOS 锁屏风格紫蓝粉渐变 + 大字时间 + 日期)
- ✅ splash 读取用户壁纸(inline IIFE 异步开 IDB 读 settings.wallpaper)
- ✅ 微信「我」value 位置统一(`.me-row-value { margin-left: auto }` 紧贴 chevron,不再随 label 字数漂移)
- ✅ 全局「新建」`+` → SVG(9 处);加 `.page-header .actions button` generic reset 防 user-agent default 方框(`.new-persona` 之前漏了 rule)
- ✅ chat-info 选项分组(常用/扩展/数据/危险 4 段)
- ✅ 删页 UI:非 editing 模式 mount 时回收尾部空页(`willEnterEdit = preserveEditModeOnMount` 守门,editing 时不动)
- ✅ 修 widget 越界压缩 grid 5 行布局(`grid-auto-rows: 0` + idempotent re-clamp + `updateWidget` clamp)
- ✅ widget 倾斜角度(-30°~30° slider,CSS var `--widget-tilt`,dragging 归零)
- ✅ MP3 widget(iPod 风格 SVG,跟 gameboy 一档)
- ✅ 最近聊天大 widget(4×3 默认,头像 + 角色名 + 最后一句 + 时间,点行进 chat)

*第二阶段 — 系统扩展*
- ✅ widget 全局风格 preset(设置 → widget 风格,6 个 preset 一键 batch update 所有 widget 的 bgColor/radius/transparency/tilt)
- ✅ app 图标管理搬到设置 → 外观(`settings/app-icons.js`,新页 13 个 app 列表,picker 扩 4 种:emoji / 文字 / 本地图片 / 图床 URL。home edit ⚙ 快捷入口保留)
- ✅ 世界书条目关键词触发(`worldbookEntries.keywords?[]`,最近 10 条消息字面命中 + 大小写不敏感 substring)
- ✅ 世界书条目向量化触发(`activationMode: 'always'|'keywords'|'vector'` 三选一独占;vector 模式 fire-and-forget embed,sourceType='worldbook-entry';`topKWorldbookEntriesForQuery` 取该 character 挂载 worldbook 的 vector entries 做 cosine top-K;阈值 `settings.embedding.worldbookThreshold` 默认 0.35 可调;注入「# 相关世界设定」段单开)
- ✅ 用户状态 per-persona(`personas.statusText / statusSetAt`,「我」tab profile 下状态卡 → openModal 编辑当前 active persona;context 新 part `user-status` 注入 state group,带相对时间「(设于 X 小时前)」)
- ✅ 行程 per-persona(`schedule.personaId?`,空 = 所有 persona 共享向后兼容;buildScheduleLines 按 sessionPersonaId 过滤;surveillance 不传 personaId,per-persona 私货不进 surveillance)
- ✅ 行程注入窗口 [-6h, +24h] → [-3d, +3d](7 天)
- ✅ AI 自加行程动作 `add_schedule_entry`(三处对齐:ACTION_SCHEMAS_TEXT schema、main.js boot `ai.registerHandler` 写 schedule store、chat.js renderAction 画 `.bubble-schedule-add` 卡片;startTs 用 ISO 本地时间)
- ✅ 行程 3 天竖向时间轴 UI(替换原 bucket list,3 列均分,HOUR_PX=28,行程作 absolute 块按 startHour 定位,跨天裁切,user/character 不同颜色边条)
- ✅ 记忆 app 角色筛选(timeline/milestones/summary 顶部 character select,月历保留)
- ✅ 聊天翻译 toggle + 双语气泡(`chatSessions.translateMode`,prompt 注入「非中文必须在 action 加 translation 字段」;text/reply 渲染 `.bubble-translate`,点击 toggle .expanded 展开下方译文)

*第三阶段 — 4 大功能 + 桌宠扩展*
- ✅ 红包/转账详情 + 24h 拒收退回(`returned: bool` + `returnedAt`;chat refresh 顶部 `expireOldMoneyActions` 扫 user 发 + 未领 + 超 24h → mark returned + 退回 wallet;non-claimable 卡片点击 → openMoneyDetail modal 显 from/when/amount/msg/状态)
- ✅ 用户心声 `msg.innerVoice`(chat-input 加 thought icon 按钮 → 展开第二行 textarea;`toApiMessage` 给 user content 后拼 `[心声:xxx]`;`BEHAVIOR_GUIDANCE` 指引「据此调整态度但不复述」)
- ✅ 角色心声 `msg.aiInnerVoice`(bubble-menu 加「心声」按钮 only-char;onBubbleMenuAction 'inner-voice' case;archived 拒;cache 命中 toggle 显示;否则调 `ai.callAI` 短 prompt + 最近 8 条 history;一锤定音不重生;**不**注入 prompt — 纯 UI 复盘)
- ✅ keepsake app 千纸鹤/叠星星(新 store `keepsakes`,**DB_VERSION 9→10**;home page 2 加入口;字段 characterId/type/theme/status('folded'|'opened'|'kept')/content?/nth/total;user 出题 → N 行 folded **不调 API**;拆 → lazy `ai.callAI` 生成 content → opened;留下 = kept 可重读 / 丢掉 = hard delete。`KEEPSAKE_SYS_TEMPLATE` 是作者占位 TODO)
- ✅ 桌宠记忆助手(聊天页戳桌宠短点 → `openMemoryHelperPanel` 弹面板:本会话 L1/L2 速览 + 常用词 + 常用指令,chip 点击复制剪贴板;其他页保留 ambient 气泡)

*行程 app:单一视图 + 打卡集成(DB_VERSION 10→11)*
- ✅ 行程 app 单视图(`schedule-list.js`):顶部月历(`.sched-cal-*`,行程 dot + 打卡 dot)+ 下方选中日详情(header「+ 行程」按钮 → 打卡 chip 行 → 24h 纵向 timeline)。点月历任一格 → 下方 timeline + 打卡 chip 切到那天。**早期做过 mode-toggle 双模式(月历+日 / 三日时间轴),后来合并掉**(三日的"跨日比较"在月历 dot 已能看,toggle 反而是额外认知成本)。`.time-entry` 右上角 × 删除,点 block 编辑;`settings.scheduleMode` 字段废弃
- ✅ 新 store `checkinTypes` + `checkins`,数据形状见数据模型表
- ✅ 打卡类型管理 modal(行程 app header ✓ 按钮)— 新建/编辑/删除,字段 name/icon(emoji)/color/targetFreq(daily / weekly:N)。删类型级联清相关 checkin
- ✅ `context.buildCheckinLines()` — 本月 N/M + ≥3 才显 streak + targetFreq 后缀;受 `settings.syncScheduleToChat` 全局门控(跟行程同源,不单设开关)。在 `buildSystemPromptParts` 第 8b' 段插「# 当前打卡(用户)」,跟 8b 「# 当前行程」并列。仅 user,character 没有打卡概念
- ✅ 死代码清理 — schedule-list.js 删了 `bucketize()` 和 `renderEntry()`,这两个老 bucket-list 时代留下没人调过

*独立文档(docs/)*
- ✅ `docs/memory-styles-spec.md` — 5 种记忆 app 视觉风格(planner/cabinet/petal/film/cosmic)指令文档,通用 JS + 5 套 CSS scope,等下一阶段实现
- ✅ `docs/schedule-refactor-spec.md` — 行程 app 双模式落地步骤完整文档(已实施)

*External review triage 修复 batch*
- ✅ `core/util.js` 收口 `esc / dayKeyOf / parseTolerantJSON`,parseTolerantJSON 用 stack-balanced 扫描替 5 处贪婪正则(ai/schedule-list/surveillance×2/bottle 已迁,旧文件本地 esc 等"碰到再迁")
- ✅ `buildScheduleLines` 区间重叠判定(原来只看 startTs 漏跨天事件,改成 `ee < winStart || startTs > winEnd` 与三日视图一致)
- ✅ `data-backup` Float32Array 序列化修(导出 `Array.from(vec)`,导入 `new Float32Array(arr)`,兼容旧 buggy 备份的 `{"0":0.1, ...}` 对象形式)+ 每 store clear+puts 改 `db.txnReplace` 原子事务
- ✅ `schedule-notify` 队列化(原来 `find()` 同分钟多条到期只弹一条剩下丢窗;现在 `filter` 抓全部排队,banner dismiss 后立刻显下一条)
- ✅ `timeline.generateMissingDays` 加 `maxDays=30` 默认上限,200 天历史一次只跑近 30 天,返回 `remaining` 让 memory-app 提示"还有 N 天再点继续"
- ✅ `router` 加 `STACK_CAP=50`,超了从头部砍,防极端跳转栈无限涨

*记忆 app 5 种视觉风格*
- ✅ [src/styles/memory-styles.css](src/styles/memory-styles.css):5 个 `body[data-mem-style="..."]` scope(planner / cabinet / petal / film / cosmic),通用通过 `.memory-app-page` 限定作用域,不漏到其他 app。`index.html` 已加 link。
- ✅ memory-app.js:加 `MEMORY_STYLES` 常量(6 项含 default)+ `settings.memoryStyle` 读写 + 右上角 chevron 切换 UI(`.ma-style-btn` / `.ma-style-menu` / `.ma-style-opt`)+ `applyMemoryStyleToBody` 设 / 清 `body.dataset.memStyle`,cleanup 也清。
- ✅ 仍未做:卡片级 tier 标签 / 时间覆盖范围 / 向量分数 / 标签 chip — 等 Phase 4 向量打标落地数据有了再装。 `docs/memory-styles-spec.md` 里的"每张卡必须显示"那段是目标态。

*Emoji 清理(铁律新增:[不擅自加 emoji](#))*
- ✅ schedule-list:`dds-label` 去 📅 / ✓,改 uppercase letter-spacing + 左侧 2px accent 边作子标题
- ✅ checkin-chip:删 `.ci-mark` ✓/○ 字符,完全靠 filled-vs-outlined 状态区分(状态能用 CSS 表达不要 emoji)
- ✅ checkin-type 默认 icon 由 `'✓'` 改空字符串;空时显示 name 首字 — 用户想用 emoji 仍可自填

*生理期 + 记忆规则 + UI polish batch(DB_VERSION 12→13)*
- ✅ **T1 API 温度精度** `step="0.001"` 支持 3 位小数
- ✅ **T2 行程 prompt 称呼真名** `buildScheduleLines` 接 `{userName, charName}`,「用户/你」→ persona.name/character.name
- ✅ **T3 引用 idx bug** 多气泡消息精确引用 — `previewMap` 复合 key + `replyingTo {msgId, actionIdx}` + `action.quoteActionIdx` + `resolveQuote(msgId, idx)`
- ✅ **T4 widget 自定义预设** `settings.widgetPresets[]` + 「+ 自定义」card + modal 集成 HSV/radius/transparency/tilt
- ✅ **T5 主题预设桌面滑动 + 默认黑白灰** `.preset-scroll` document-level wheel-to-horizontal handler + 桌面薄滚动条;`DEFAULT_THEME` 改成黑白灰系数值(只影响新用户)
- ✅ **T6 打卡简化** 删 `streak` / `targetFreq` 显示和字段,`buildCheckinLines` 只保留「本月已打 N/M 天」
- ✅ **T7 状态同步** persona 详情页加 statusText 字段(跟微信「我」共享同一字段,statusSetAt 只在 text 变化时 bump)
- ✅ **T8 保存按钮 dirty 反馈** `core/form-helpers.js#bindFormDirty` + `.btn.saved` 灰扁化,接入 API 配置 / 角色 / persona / 主题 / 设置-记忆 / 向量记忆 / 天气 7 页
- ✅ **T9-T11 生理期 / 周期 app**(全新功能):新 store `cycle` + `cycleSymptoms` / `core/cycle.js` 算法 / `core/cycle-notify.js` boot 通知 / `features/cycle/cycle-app.js` 3 tab UI / `buildCycleStatus` prompt 注入双门控
- ✅ **T12 AI 行程引入记忆 + 已有行程** `openAIGenModal` 拼 角色 L1+L2 记忆(最多 30 条)+ 同窗口 ±1 天已有行程,prompt 加约束
- ✅ **T13 archive banner more 风格** dashed → solid 边框、accent 色 hover、居中 chevron 旋转 180°、CTA 文案「点开看被总结的 N 条聊天 / 收起这 N 条」
- ✅ **T14 立即提取记忆按钮** `maybeCompressMemory` 加 `{force:true}` 跳过 threshold buffer;chat-info 页加按钮
- ✅ **T15 memory 输出改行式 + 老数据兜底** prompt V2→V3 行式(`摘要: ...\n标签: ...`)解决 LLM 在 summary 内用未 escape 引号破坏 JSON 的 bug;`normalizeMemorySummary` 在 6 处 render 点接入,挽救 V2 时代存 JSON 字符串的老数据(JSON.parse 优先 unescape,失败 regex 提取)
- ✅ **T16 timeline 不跳今天 + 自动同步** `generateMissingDays` 删 today 过滤,「每次总结自动更新」实际早就在(`maybeCompressMemory` 末尾 fire-and-forget),只是被 today 挡了
- ✅ **T17 memory 按 dayKey 分组** `maybeCompressMemory` 重写:active > threshold 时把溢出按 dayKey 分组,每次只压**最旧那一天**(渐进消化);`memoryBatchSize` 字段废弃;默认 threshold 20→30
- ✅ **L2 memory fromTs/toTs 修** 之前 L2 rollup 时漏填这俩字段,导致 `formatMemoryWithDate` 退到 createdAt 显示"L2 合并那天"。从 toMerge 的 L1 取范围,老 L1 没就 fallback createdAt
- ✅ **方块阴影修** 全局 `* { -webkit-tap-highlight-color: transparent }` 关浏览器默认 tap 高亮
- ✅ **modal.js 扩** field.kind 加 `checkbox`(返回 true/false)/ `select`(takes `options: [{value, label}]`)
- ✅ **user 消息气泡左边界 bug** `.msg-row.user` 加 `padding-inline-start: 52px` mirror char-row 的 avatar+gap 占位,防止 long content 时 user bubble 左边界冲过对方头像那侧的对称位置(测试前 left=20 / avatar.right=48 breach 28px;后 left=72 留 24px buffer)

*记忆架构 V4:多卡故事页 + 多事件 timeline + 重要度(DB_VERSION 14→15)*
> 参考 user 朋友的酒馆站设计:总结允许切成多张独立故事卡(title + 段落 + 关键原话 + tags + 重要度),timeline 一天允许多事件。我们采纳了多卡 + 多事件 + 重要度,跳过了 AI 自触发检索 / NPC roster / 召回标记 / 自动归档 toggle(用户决定 — 日常聊天大部分 low,filter 掉就没记忆,所以两档都注入,importance 只影响 UI 显示)。

- ✅ **memory prompt V4 多卡** `DEFAULT_MEMORY_SYS` + `MEMORY_OUTPUT_RULES` 改 `[CARD]...[/CARD]` 块结构,允许 1-3 张卡 / 卡。`parseMemoryOutput` 重写:返回 array,先匹配 [CARD] 块 → 多卡;落空 V3 单卡 fallback;再落空整段当 summary。`maybeCompressMemory` 写 N 行同 txn,共享 `groupId`;每张卡独立 embed(故事粒度比单大段精准);老 V3 / V2 数据自动 1 张卡呈现
- ✅ **重要度 high/low** 每张卡填一档,默认 low。**两档都注入 prompt**(日常聊天大部分 low,filter 掉就没记忆)。importance 只影响记忆 app 显示:high 加 accent 左边 + 「重要」红 chip + 标题加粗。`formatMemoryWithDate` 注入时若 title 存在拼 `[标题] summary` 帮模型定位章节(quotes 不进 prompt — 给用户翻看)
- ✅ **timeline 多事件/天** `DEFAULT_TIMELINE_SYS` 改"拆成 2-5 个独立事件每行一个 ≤25 字"。`splitTimelineEvents(raw)` 按 \n 拆 + 兼容老逗号串 + 去前缀编号 + clamp 25 字 + cap 5 条。`generateMissingDays` 写 N 行带 `eventIdx`,共享 dayKey/fromTs/toTs。`mergeDays` 合并后 \n-join 多事件存单行 summary。`MAX_SUMMARY_LEN` 50→25
- ✅ **memory-app 卡片渲染** `buildMemCard` 加 `title` / `quotes` / `importance` 三参数。title 渲染加粗标题,quotes 渲染「关键原话」section(dashed 边分隔,默认展开),importance=high 加 `ma-row-imp-high` 左 accent 边 + 「重要」红 chip。timeline 排序加 eventIdx 次级
- ✅ **memory-manage 同步** chat 内 memory-manage 页同款渲染:`.memory-title` 加粗 + `.memory-imp-high` 红 chip + `.memory-quotes` dashed 分隔
- ✅ **CSS** `memory-styles.css` 加 `.mem-imp-high` / `.ma-row-title` / `.ma-row-quotes` + `.ma-row-imp-high` 边色;`.ma-row-body` 加 `white-space: pre-line` 让 \n 渲染换行(merged timeline 多事件用);`base.css` 同样加 `.memory-card` 系列样式 + `.tl-row .tl-summary` pre-line

*视觉 bug 修 + 「这次发生了」事件链(差异化关键)*
> user 反馈记忆卡片结构跟参考酒馆站太像,想要"手机 app 维度"的差异化。她记的是 RP 戏剧章节;我们多一层手机原生 action 事件维度(红包/转账/语音/照片/撤回/位置/计划/解封),零 AI 成本(action 数据已在 chatMessages 里)。

- ✅ **film 双胶片条码 bug** `.ma-row::before`(老 B/W 条纹)和 T27 加的 `.ma-row::after`(accent 点线)在 V4 多卡后视觉上叠在一起,删 `::before` 留 `::after` 单条
- ✅ **petal 花瓣装饰位置 bug** `.ma-row::after` 的 ✿(\273F)从 top:8px 挪到 bottom:8px,跟新加的 title / 编辑×删除按钮 / chips 不再挤在顶部;字号 28→22,opacity 0.18→0.14 更隐
- ✅ **「这次发生了」事件链** `core/context.js#extractMemoryEvents(msgs)` 扫 overflow 的非 text/reply actions 生成 plain 中文 chip(无 emoji):
  - 红包/转账:每笔单独 + 金额 + 方向(用户→角色 / 角色→用户)+ 状态(已领/未领/已退回 / 已收/未收/已退回)
  - 位置 / 定计划 / 请求解除拉黑:每条单独
  - 语音 / 照片 / 撤回:按类型聚合计数(语音带总时长 `共 N″`)
  写入第一张卡(多卡共享 overflow 时间窗,事件链是窗口级 metadata 不是卡片级,挂多张会重复);events 字段不进 prompt(summary 已覆盖);
  `buildMemCard` 加 `events` 参数,渲染「这次发生了」section,quotes 下方 dashed 分隔,chip 是 accent 浅底圆角药丸;chat 内 memory-manage 同款 `.memory-events` 渲染。差异化效果:酒馆站不能有这些手机原生事件,一眼区分

*T30-T35 记忆 app 视觉打磨 + timeline 时刻化 + 字体回归修*
> 一轮密集 UI 反馈:卡片对齐、按钮位置、tab 换行、tag 颜色冲突、字体加载、film 反色条 inline pill 化等。共 11 个 commit,跨 4-5 个迭代收敛到稳定视觉。

- ✅ **T30 timeline HH:MM 时刻** `core/timeline.js#formatMsgForTimeline` 给每条消息拼 `[HH:MM]` 时间戳让 AI 知道每行事件几点发生。`DEFAULT_TIMELINE_SYS` 要求每行 `HH:MM 事件` 开头(带示例);`MERGE_SYS` 跨天用 `MM-DD HH:MM`。`splitTimelineEvents` 去编号正则改成只匹配 `1.` / `(1)` / `1)` 等明显格式,**不再吞 `09:23` 这种时间前缀**(原 `\d+[.、)]?` 正则把 `09:` 当编号砍掉)。`MAX_SUMMARY_LEN` clamp 25 字不算 HH:MM 前缀,事件正文留满预算。
- ✅ **T30 timeline 多事件每条 row** 渲染时 `meta = [formatTimeRangeFull(t.fromTs, t.toTs), labelFor(t.sessionId)]`(timerange 全天 + 角色名),body 显示带 HH:MM 前缀的单事件
- ✅ **T31 memory app 角色 chip filter** timeline/milestones/summary tab 顶部 character select(横向 chip + 全部 chip)
- ✅ **T32 film 手机端减压** `@media (max-width: 440px) body[data-mem-style="film"]` 缩字号/gap/齿孔条,padding 走桌面统一 12px 不动(防止 mobile 和桌面 padding 不一致导致视觉错位)
- ✅ **T32 cosmic 星河深夜化** 基底固定深紫黑渐变 `#0d0a1e → #1a1232`(不依赖 --accent),文字月光米白 `#e6dfc8`(暖白不刺眼),柔紫次色,半透白叠加卡片(玻璃感)。星点 / hover glow 保留 accent 联动。原 `color-mix(--accent 25%, #fff)` 在浅 accent 主题下接近纯白刺眼 → 固定米白
- ✅ **T32 字体自定义无效回归修** `core/theme.js#ensureFontLink` 删 `link.crossOrigin = 'anonymous'` — 第三方字体 CDN(zeoseven 等)没配 CORS Access-Control-Allow-Origin header 会被浏览器整个拒绝。stylesheet `<link>` 加载字体根本不需要 anonymous CORS。Google Fonts 没这个 attr 也正常。**这是回归** — 9c87adb 初始就 set 了 anonymous,Google Fonts 工作所以一直没发现 zeoseven 失败
- ✅ **T32 字体 family 输入 sanitize** `sanitizeFamilyInput()` 按逗号切只取第一 token + strip 外引号 — user 经常误填 `"Font", sans-serif` 整段 stack 进 family 字段,sanitize 比报错友好
- ✅ **T32 settings → 记忆总结 加 2 个 toggle** `memoryShowQuotes` / `memoryShowEvents` 控制记忆卡片是否渲染「节选」/「这次发生了」区段(默认开,关掉只让卡片瘦身,memory 数据仍写入)。memory-app + chat memory-manage mount 时读 flags
- ✅ **T32 memory prompt quotes 1-5 条** `MEMORY_OUTPUT_RULES` 改 "最多 3 条" → "1-5 条"
- ✅ **T32 「关键原话」→「节选」** memory-app + chat memory-manage 两处同步;搜索栏左侧"搜索" label 删(placeholder 已暗示功能)
- ✅ **T33 搜索栏去外框** `.mem-vector-hits` 原 accent 浅底 + 边 + 12px 圆角让搜索栏比下面真记忆卡还显眼。改 transparent / 无边 / 零 padding,只 input pill + 浅底,焦点态 accent 边框;cosmic 同步改
- ✅ **T34 ✎× 按钮挪进卡片 inline** 原 `absolute top-right` 跟 meta/chips 抢位置 user 多次反馈"放上面或里面"。改成 `.ma-row-meta-row` flex 容器内右端,跟 meta(日期·角色名)同行(meta 有时);meta 空时 fallback 跟 chips 同行(`.ma-row-header`)。`buildMemCard` 加 `tools` 参数,4 处调用点拆 buttons → tools。base.css 删 absolute 样式
- ✅ **T34 「这次发生了」chip 离底** `.ma-row-events` 加 margin-bottom 4 + padding-bottom 2;film 风格 `.ma-row` 加 padding-bottom 8。chip 不再紧贴卡片底
- ✅ **T35 tab 中文不换行** base `.ma-tab { white-space: nowrap }` 防中文按字断行("时间线" 断成 "时间/线");cabinet/petal tab padding `14 → 10`、petal margin `3 → 2`,让 5 个 tab 在 phone-frame 380px 内排得下
- ✅ **T35 planner tab "黑粉冲突" 修** 原 active tab 同时有 solid 灰边框 + accent 底部 inset 阴影双重指示。删 border + box-shadow,只用 accent `border-bottom` 跟其他风格统一;inactive tab 删 dashed border(顶/左右),保留容器底部 dashed 体现纸纹辨识
- ✅ **T35 planner char chip dashed 改 solid** user 反馈"虚线丑",改 solid 1px 灰 18% 收敛视觉但保留 planner 辨识
- ✅ **T35 planner chip 不再 rotate** 原 `transform: rotate(-1.2deg)`(纸胶带美学)让 chip 视觉歪斜跟 title 看不齐(boundingRect 数据上对齐但人眼不齐),删旋转
- ✅ **T35 花瓣 letter-spacing 收** `.ma-session-group summary` 原 `letter-spacing: 4px` 把"问影渠"撑成"问 影 渠"显凌乱,改 1px 保留字距但不松散
- ✅ **T35 timeline tab body 居中** `.ma-row[data-tl-id] .ma-row-body { text-align: center }` — 每条 ≤25 字短事件居中更易读;summary/milestone/profile 仍左对齐
- ✅ **T35 meta-row 改 inline pill** `.ma-row-meta-row { display: inline-flex; align-self: flex-start; background; padding; border-radius }` 自然宽不撑满 row(被 `align-self: flex-start` 防 stretch;flex item display inline-flex 被浏览器 blockify 成 flex 但 align-self 仍生效)。所有风格通用浅灰底 pill,film 风格 override 反色 fg/surface 配色 + 减矮 padding 1px + margin 对称 8/8。tools 包在 pill 内
- ✅ **L1 chip 对齐 — 4 次迭代收敛**:
  1. 第 1 次:planner chip `transform: rotate(-1.2deg)` 让 chip 视觉歪斜 → 删 rotate
  2. 第 2 次:user 反馈仍"偏右" → chips margin-left `-7px` 让 chip text 跟 title 对齐(残留 1px 偏差因 planner chip padding 8 不是 7)
  3. 第 3 次:user 反馈仍"还有空隙" → 各风格 specific margin override planner/cabinet `-8`、film `-6` 让 chip text 完全跟 title 文字同位置(56 = 56)
  4. 第 4 次:user 反馈 chip 框比 title 偏左 8px(因为 negative margin 让 frame 突出 row.content-left)→ 试 `第一个 chip padding-left 0` 让 frame + text 都跟 title 对齐
  5. 第 5 次:user 反馈 L1 "在框里贴左侧应该居中" → 删 first-child padding override,恢复对称 padding,chip 内 text 自然居中 chip frame。**最终态:chips margin 0 + 各 chip 对称 padding,chip frame outer-left 跟 title text-left 对齐(56=56),chip 内 text 偏右 7-8px(对称 padding 不可避免)**
- ✅ **按钮重叠 → 间距修** 原 `.ma-row-edit right: 32px` 跟 del 按钮(占 right [6, 36])重叠 4px,改 `right: 40px` 留 9px 视觉间距(后来按钮整体改 inline 这条作废)
- ✅ **film 卡片字对齐统一** `.ma-row` padding 0(齿孔条 + 反色 meta 布局必需)+ 各子元素 inline padding 不一(chips 12 / body 14 / title 0 / quotes 0)导致左对齐错位。统一 title / body / quotes / events / header padding-left/right 12px,跟 chips/meta margin 12 对齐
- ✅ **film 反色条延伸到 ✎× 后面** background/color 从 `.ma-row-meta` 挪到 `.ma-row-meta-row` 容器,整 meta-row 反色;tools 在 fg 暗底用 surface 浅色 + hover 加浅底强调

---

### TODO 待办

**等用户文案 / 决策**:
- 桌宠 `BEAR_PERSONA` + `AMBIENT_LINES` 7 场景(每个 1 条占位)、`bottle.js` 4 处 TODO。**`KEEPSAKE_SYS_TEMPLATE` + `BEHAVIOR_GUIDANCE` 已 user 定稿**(后者 9 个动作语境完整,见 `src/core/behavior.js`)
- 行程 3 天时间轴 + 月历美化风格(等 user 给 reference,demo 已 functional)
- 监控反向注入聊天(user 在想 — 因为不只是当前帧,可能要包括历史画面)
- 网站地址 / KKphone.com(等 user 买域名,有了我加 CNAME 文件)
- 红包动画(user 明确不做)
- `state` 数值化动作(user 明确**绝对不要**)

**记忆架构 Phase 2+**:
- 阶段 2 用户画像 per (角色×人设) — 压缩 prompt 同时吐画像 patch,inject system prompt 顶部
- 阶段 4 向量打标(转折点/情感/日常)+ `buildVectorRecallLines` boost

**记忆 app 卡片级增强(等 Phase 4 数据)**:
- 每张卡显示 tier(L1/L2)+ 时间覆盖范围 + 向量分数 + 标签 chip — 需要 Phase 4 向量打标先落地,数据有了再装。占位的 `.mem-card-tags` / `.mem-vector-hits` 区块还没建,等真有数据再加避免空容器视觉噪音

**永远会做的小事**:
- 位置功能进阶(地图选点)

### Phase 2(MVP-2)
- **群聊**:`chatSessions.participantIds[]` 字段、群里「谁该说话/什么时机说」机制(导演 + 演员两层 — 第一层轻量导演选 speakers,第二层每个 speaker 走现有单角色管线)。新建对话 modal 入口已预留(`new-group` 按钮,目前 alert 占位);action schema 已加可选 `from` 字段(单聊省略、群聊角色名)
- **环境上下文扩展**(按铁律 12 模板):
  - ✅ **角色当前活动主动注入**:监控 `feedToChat` toggle + 全局 `syncMonitorToChat` → 「# 角色当前活动」段。落地于 `buildActivityLine`,纯第一人称事实陈述。
  - **监控被察觉反向注入聊天**(可选 toggle 进一步):open 模式可以让画面信息直接进角色 prompt(角色本就知道有镜头),spy 模式可以让用户在 chat 看到画面后用「📍 我刚看到你」给 prompt 加观察事实。这是把现有 `# 角色当前活动` 段从「视角:角色自己」扩展到「视角:用户监视过的事实」

### Phase 3+(应用扩展,同模式复制)
- 朋友圈、论坛、推特、日记、语音视频电话、监控、商城

### 永远不会做
- 任何把 API key 上传到非用户浏览器的事
- 给单个角色固化的行为引导 prompt(违反铁律 3)

---

## 开发流程

- 静态 dev server:`node dev-server.mjs`(端口 5173,零依赖)。**任何 ES modules 必须经 http 服务,不要 file://**。
- Claude Code 自带 Launch preview:`.claude/launch.json` 已配。**前提是 Claude Code 在项目目录开会话**——在别的 cwd 开它就只会自动找 cwd 下的 launch.json。
- git 双机:笔记本写 + push,SSH 主机 pull。
- GitHub Pages 给最终用户:push 后 Pages 自动更新。**iOS PWA(添加到主屏幕)用户**靠 Service Worker `sw.js` detect 更新:每次 commit 前把 `sw.js` 里的 `CACHE = 'phone-app-vN'` 改大一位(`v1`→`v2`→...),user 下次打开 PWA 自动弹「有新版,点击重启」banner。**不改 vN 就不会弹**(`base.css` / `chat.js` 单独改不触发),这一步是 commit 流程的硬性环节。
- 本仓库 git config(local):`user.name=Kyuu`,`user.email=252411668+Kyuuuuuovo@users.noreply.github.com`

---

## 给将来的我

如果用户提出某个新功能,**先确认它是不是违反「铁律 3」**(在 prompt 里加行为引导)。如果是,推回去——用 `character.persona` 表达,不要碰 `OUTPUT_FORMAT_SPEC`。

如果用户加 UI 元素,**先看是不是能 fit 进现有的 `.icon-btn` / `.attach-item` / `.bubble` / `.settings-item` 等已有视觉单元**。能用已有的就别造新的。

如果用户问「能不能加上某种 emoji 占位」**第一反应是问问要不要做成 SVG**——这个项目里 emoji 用在 `attach-item` 这种"以后会扩展"的位置,正式视觉用 SVG。
