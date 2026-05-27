# phone-app

纯前端 SPA 角色扮演手机 app。所有 JS 在浏览器执行,数据存 IndexedDB,AI 走用户自填的 OpenAI 兼容 endpoint。**作者不维护任何后端**。最终分发形态:GitHub Pages 静态托管。

---

## 当前状态(MVP-2 中 — 多 app 框架 + 钱包/收藏/行程/装饰位)

### 后端核心(`src/core/`)

- `db.js` —— IndexedDB 封装。`STORES` 常量是数据模型唯一来源。改动需 bump `DB_VERSION`。当前 `DB_VERSION = 9`。导出 `init / get / set / getAll / query(store, indexName, value) / del / clear / newId / updateSettings`。
- `pet.js` —— 桌宠模块。常量 `BEAR_PERSONA / AMBIENT_LINES`(作者锁定文案,普通用户改不到),保留 ID `BEAR_CHARACTER_ID = '__bear__'` / `BEAR_SESSION_ID = '__bear_session__'`;`ensureBearExists()` boot 时幂等保证两条 row 存在;`pickAmbientLine()` 按规则(无 API / 无角色 / lastMessageAt 老旧 / 时段)挑一条气泡文案,**不调 API**。聊天复用现有 chat 管线,不另起。
- `bottle.js` —— 漂流瓶核心。`scanDueBottles(db, ai)` 找 `replyDueAt <= now` 的 drifting 瓶子懒生成回信(boot + open app 时调用);`replyAsContact` / `replyAsStranger` 分两种受众生成回信(联系人模式注入"匿名"事实让角色不知道作者是谁);`fishBottle` 让 AI 现造陌生人 + 瓶子内容;`promoteStrangerToFriend` 把瓶子上的 `generatedPersona` 升格成正式 character。**所有 prompt 文案是 // TODO(作者填写) 占位**,Claude 不替作者定稿语气。
- `surveillance.js` —— 监控模块。`generateSnapshot(cameraId)` 拼专用 system prompt(persona + schedule + 最近聊天 + 房间 + angle + 模式事实 + 视角刚变动 hint)→ 严格 JSON schema(`{location, posture, activity, mood, caption, noticed}`)→ 写 `activityLog`,spy mode 且 noticed=true 时 flip `camera.discoveredAt`(铁律 9)。`proposeRooms(characterId, {excludeRoom})` 让 AI 给 3-4 个 ta 同意装/换机位的房间,prompt 里附"已装 N 台公开摄像头(房间:A、B)"上下文,允许 AI 返回 `[]` 表示 ta 拒绝再装。`proposeAngles(characterId, room)` 给 3-4 个合理镜头朝向(转动镜头流程的"AI 推荐"路径)。所有函数 `temperature: 0.4`。
- `context.js` —— `buildSystemPromptParts(sessionId)` 返回结构化分段数组 `[{key,title,body,kind,...}]`,`buildSystemPrompt(sessionId)` 把它 join 成最终字符串(18 段,见函数注释)、`buildMessageHistory(sessionId, maxRecent=40)`、`maybeCompressMemory(sessionId)`(读 `settings.memoryEnabled / memoryThreshold / memoryBatchSize`,默认 enabled + 20 + 10;**filter 掉 archived 后再算 overflow**;memory + 所有 archived msg 在一个 `db.txnPut` 里原子写)。`buildMessageHistory` 的 `collapseAdjacentSameRole` 时间敏感:同 role 但间隔 > 5min 的消息合并时会插入 `[过了 N 分钟/小时/天]` 标记,模型能看到真实时间间隔。prompt 第②层「当前状态」自动注入 `# 当前行程` / `# 摄像头` / `# 角色当前活动` / `# 相关记忆(按语义检索)`(后者向量记忆 enabled 才有,见 [core/embedding.js](src/core/embedding.js))。`HUMANIZER_PROMPT` / `BEHAVIOR_GUIDANCE` / `OUTPUT_COUNT_SPEC` / `ACTION_SCHEMAS_TEXT` 四段支持 settings 覆盖层。`buildScheduleLines` 已 export,surveillance.js 复用同一份。
- `timeline.js` —— 时间线模块。`generateMissingDays(sessionId)` 懒生成过去日期的每天一句话总结(≤40 字),今天不生成,每 dayKey 只生成一次;`mergeDays(sessionId, ids)` 把多天合并成一条新行(原始行标 `mergedInto`);`unmerge(sessionId, mergedId)` 撤销合并。**时间线不进 system prompt,只给用户翻看**;并行于 `memories`(L1/L2),互不触发互不删。文案常量 `DEFAULT_TIMELINE_SYS` / `DEFAULT_TIMELINE_MERGE_SYS` 作者锁定,可空。
- `ai.js` —— `callAIOnce / callAI / requestReply` 三层。tool calling 支持 `get_current_time` / `get_weather` / `get_location`(按 chatSessions 的 toggle 启用)。`requestReply` 顶部有 `Map<sessionId, Promise>` in-flight 锁(防多 tab 共享 IDB 时并发触发记忆重复 archive),末尾调一次 `maybeCompressMemory`。
- `weather.js` —— 用户填 URL 模板 + key 的统一接口,响应原文 ≤1500 字传给 AI 自己解析(`PRESET_TEMPLATES` 是 3 个一键预设按钮)。
- `theme.js` —— 单一活动主题。`DEFAULT_THEME` / `FONT_OPTIONS` / `GLASS_OPTIONS` / `TEXTURE_OPTIONS` / `THEME_PRESETS`(内置 + 用户保存)。`applyTheme()` 把字段写成 `:root` CSS 变量 + `body.dataset.fx-*` 属性,所有页面联动。
- `modal.js` —— 通用页内 modal helper(`openModal(container, {title, fields, submitLabel})`),代替 `window.prompt()`。chat / wallet 都用。
- `router.js` —— 页面栈。`setContainer / registerPage / navigate / back`。

### UI(`src/features/`)

- 全局壳:`.phone-frame` 用 `clamp(400px, calc((100vh - 24px) * 9 / 19.5), 480px)` 自适应桌面比例 + `align-items:center` 居中。状态栏:时间 + 4 根渐高竖线信号 SVG + 电池(`navigator.getBattery()`)。
- **首页 (`home`)** —— 2 页 + 4-槽 dock,统一 4×6 grid(unifiedGridV1):
  - 每页是 4 列 × 6 行的格子(`aspect-ratio: 2/3`),app 和 widget 共用 grid 位置 — 每个 item 存 `(row, col)`,widget 还存 `colSpan/rowSpan`;空 cell 无元素直接看到壁纸 (iOS 稀疏布局)。home.js 顶层常量 `ROWS=6 / COLS=4 / DOCK_SLOTS=4`。
  - 第 1 页:角色 / 世界书 / 人设 / 记忆 (app 默认 row=1);widget 也只在 page 0 显示 (widgets store 没有 page 字段,数据模型决定)
  - 第 2 页:行程 / 日记 / 推特 / 论坛 / 商城 / 监控(已实) / 漂流瓶
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
  bubble menu(右键 / 长按 500ms):引用 / 复制 / 收藏 / 删除;
  ⋯ 更多 → `chat-info`(置顶 toggle / 显示已读 toggle / 会话设置 / 聊天美化 / 记忆总结 / 编辑角色 / 清空 / 拉黑)
- **监控 (`monitor` / `monitor-view`)**:列表 + 单画面卡。添加机位三步 modal:选角色 → 选模式(光明正大 / 偷窥)→ 选房间(光明正大走 `proposeRooms`,偷窥用户自填)。画面是 CCTV 风格深灰卡 + 噪点 overlay + saturate/hue 滤镜,显示 location/posture/activity/mood/caption + 红点 REC + 时间戳。spy 被察觉后顶部红条 + camera.discoveredAt 写入。快照式:刷新 = 一次 API 调用 = 一帧。
- 已注册路由 (~36 个):
  - `home / settings / settings-api / settings-api-detail / settings-weather / settings-theme / settings-memory / settings-embedding / settings-data / settings-clear`
  - `messaging / chat-list / chat / chat-info / chat-beautify / chat-settings / memory-manage / prompt-inspector`
  - `character-list / character-detail / worldbook-list / worldbook-detail / persona-list / persona-detail / persona-pick`
  - `wallet / favorites-list / schedule / monitor / monitor-view / bottle / memory`
- **DevMode + 提示词调试 (`prompt-inspector`)**:设置 → 调试 → 开发者模式 打开后,聊天页右上角多一个齿轮 icon,跳到调试面板。面板:(a) 列出所有 apiConfig,radio 切活跃配置,**下一轮回复立刻用新配置,不需要刷新**;(b) 按真实注入顺序列出所有 prompt 分段(`buildSystemPromptParts`),每段显示 kind 标签(计算 / 数据 / 源常量 / 已覆盖)+ 是否「未注入」+ 警告(如改 OUTPUT 两段会破坏 JSON 契约);(c) override 段(humanizer / behavior / countSpec / schemasText)有「编辑」「保存」「恢复默认」,空字符串覆盖保留为「故意不注入」;(d) data 段有「去编辑 →」跳对应页;(e) 「显示完整 dump」原样输出 `buildSystemPrompt` 最终字符串。终端用户 devMode 默认关,看不见入口。
- **桌宠**:全局悬浮球,挂在 `.phone-frame` 内、`#page-container` **兄弟节点**(跨页常驻,不走 router)。交互三档:**短点 = 冒一条氛围气泡**(强制 fresh,绕过冷却);**长按 (touch/pen 600ms) / 右键 = 进 `chat` sessionId=`__bear_session__`**;>4px 拖动 = 持久化新坐标。氛围气泡按规则(无 API / 无角色 / lastMessageAt 老旧 / 时段)挑文案,**不调 API**。位置 / 开关 / 气泡冷却进 `settings`。`__bear__` 在 character-list / contacts / 新建对话 modal / monitor 选角色 / 行程选角色 等所有"选角色"界面都被过滤(`c.id !== '__bear__'`),编辑入口只在 设置 → 桌宠 → 编辑桌宠人设(跳 `character-detail`)。
- **漂流瓶 (`bottle`)**:网络隐喻(不是物理瓶子,UI 文案避开"海里/捞/漂着"),保留 audience 二选一,一瓶一回。两种受众模式:**contacts** = 从非内置非拉黑 character 里随机挑一个回信,注入 `ANONYMITY_FRAMING_FOR_CONTACTS` 让 ta 不知道作者是谁;**strangers** = 用 `STRANGER_PERSONA_GENERATOR_SYS` 现造一个网络上的陌生人(任何国家时区/年龄/身份/心情 — 强调多样性,不要默认温柔好人)再让 ta 回。发时只存 row(`status='drifting'`、`replyDueAt = now + 30min-4h 随机`);boot + 打开 app 时 `scanDueBottles` 找到期 drifting → 懒生成回信(**模块级 `_scanning` 锁防 boot+app-open 并发**)。"随机收一条" = AI 现造陌生人 + 写一封瓶子。回信 / 发的人支持「加好友」一键升格成正式 character。回信是**纯文本**,不走动作协议,不进 chatMessages —— 单独存在 `bottles` store。
- **独立记忆 app (`memory`,home 第二页入口)**:跨会话的记忆总览,4 tab:**月历**(当月格子 + 时间线/总结/纪念日三色点 + 点格子看当天细节 modal + 「加纪念日」直达)/ **时间线**(跨会话的一句话日总结 + 会话标签)/ **纪念日**(`milestones` store,可关联角色 + 每年重复)/ **总结**(跨会话 L1/L2 memories,按会话折叠分组)。不进 system prompt,纯用户视图。**chat 内的 memory-manage 还在**(session-scoped 操作 — 删 summary / 风格 override / 时间线 tab + merge / 导出文本),两者并存。
- **向量记忆 (设置 → 向量记忆 / `settings-embedding`)**:OpenAI 兼容 `/v1/embeddings` 端点。配置后:每条 memory 生成时 fire-and-forget embed → 存 `embeddings` store(`Float32Array`,IDB 原生 structured-clone)。每次 `requestReply` 把最近 5 turns(user + assistant 混合)拼成 query → cosine top-K(**阈值 ≥ 0.35**,默认 K=5)→ 注入 prompt 的「# 相关记忆(按语义检索)」段,位置在「# 远期记忆」之前。3 个预设按钮(OpenAI / 硅基流动 BGE / DashScope Qwen)。「补齐旧总结」按钮串行 + 150ms 间隔,不会撞速率限制。默认关 — 每轮回复多 1 次 embedding API 调用,opt-in。
- **modal helpers (`src/core/modal.js`)**:`openModal({title,fields,...})` Promise<obj|null>(收输入)、`openConfirm({title,message,danger?})` Promise<bool>(确认)、`openAlert({title,message,danger?})` Promise<void>(单按钮提示)。**全部页内 modal,不要再用 `confirm()` / `alert()`**(已经把项目里所有 22+24 处全替换了)。Esc/Enter/click-outside 都处理了。`danger:true` 把按钮/标题染红。

---

## 数据模型(`db.js` STORES,DB_VERSION = 9)

| store | 主键 | 索引 | 说明 |
|---|---|---|---|
| `characters` | `id` | — | 角色,字段 name / persona / avatar / notes / blocked / **chatBackground**(per-character 聊天背景 base64)/ **chatFontSize**(per-character 字号覆盖,null 表示跟随全局)/ createdAt / updatedAt |
| `worldbooks` | `id` | — | 世界书容器(只有元数据) |
| `worldbookEntries` | `id` | worldbookId | 条目,字段 title / content / enabled / `position` / `keywords?` / createdAt。`position` 三档:`before`(角色设定前)/ `inline`(角色设定后,默认)/ `after`(用户人设后)。**title 只是用户索引,不进 prompt;只 content 会被注入。** 同 position 内按 createdAt 升序排。`keywords` 是 string[](逗号分隔输入,UI parse 成 array):空 / undefined = 一直注入(向后兼容);有值 = 只在最近 10 条聊天消息任一里出现其中一个 keyword 时才注入(SillyTavern lorebook 风格,大小写不敏感 + substring 匹配) |
| `characterWorldbooks` | `id` | characterId, worldbookId | 多对多关系表,字段 priority |
| `personas` | `id` | — | 玩家人设库 |
| `chatSessions` | `id` | characterId, lastMessageAt | 字段 characterId / personaId / title / createdAt / lastMessageAt / **isPinned** / `showReadReceipts`(默认 true)/ `readReceiptUpToTs` / `memoryPromptOverride`;会话感知 toggle:`{char,user}TzEnabled` / `*WeatherEnabled` / `*LocEnabled` + `*CityMode` / `*CityKey` / `*CityLabel` |
| `chatMessages` | `id` | sessionId, createdAt | role(`user`/`character`/`system`)/ **actions[]** / createdAt |
| `memories` | `id` | sessionId | 长对话压缩摘要,字段 sessionId / `tier`(1=近期 L1 / 2=远期 L2) / summary / fromMsgId / toMsgId / `archived?` / `archivedAt?` / `archivedIntoMemoryId?`(其实是 chatMessages 字段;memories 自身不带 archived)/ createdAt。**L2 删 L1 时同时清对应 embeddings 行**(否则 vector 表有孤儿) |
| `apiConfig` | `id` | — | 多条;每条 id / name / apiUrl / apiKey / modelName / temperature。当前活跃由 `settings.activeApiConfigId` 指 |
| `settings` | `id` | — | 单例 id=`default`。字段:`theme`(对象,见 [core/theme.js](src/core/theme.js))/ `themePresets[]` / `wallpaper`(base64 桌面壁纸)/ `activeApiConfigId` / `activePersonaId`(新建会话用)/ `weatherApi: {urlTemplate, apiKey}` / `memoryEnabled`(默认 true)/ `memoryThreshold`(默认 20,**缓冲条数** — 总结之后保留多少条活跃)/ `memoryBatchSize`(默认 10,**一次总结条数** — 每次触发压几条;触发 = 缓冲 + 一次总结)/ `petEnabled`(默认 true)/ `petX` / `petY`(悬浮球持久化坐标)/ `petLastBubbleAt` / `petDismissed: {triggerKey: ts}`(气泡冷却记录)/ **`tileOrder: [[{id,row,col}, ...], [{id,row,col}, ...]]`**(每页 app 的位置数组,unifiedGridV1 后用 object form;app 也可跨页拖,persistMove 负责从原页 remove)/ **`dockOrder: [appId\|null, ...]`** (4-槽数组,默认 `[null, 'messaging', 'settings', null]`;app 双向拖 dock↔pages 由 persistMove 同步)/ `syncScheduleToChat`(默认 true)/ `syncMonitorToChat`(默认 false,opt-in)/ `devMode`(默认 false)/ `promptOverrides: {humanizer?, behavior?}`(`??` 语义:不存在=源常量、`''`=故意不注入)/ `promptOutputOverrides: {countSpec?, schemasText?}`(同上,改了会影响 JSON 输出契约要小心)/ `embedding: {urlTemplate?, apiKey?, modelName?, enabled?, topK?}`(向量记忆 endpoint + 启用 toggle + top-K)/ **`favoritesMigratedV1` / `unifiedGridV1`**(home 一次性迁移 flag,first-mount 设)。**所有 settings 修改用 `db.updateSettings(fn)` 原子化**,不要再 `get → 改 → set` 三连(setupPet 那种夹 await 的写法会被并发覆盖)。`humanizerPrompt` 字段已废弃,在 `src/core/humanizer.js` 常量里 |
| `wallet` | `id` | — | 单例 id=`default`,字段 balance。用户发红包/转账扣余额,领 AI 红包/转账加余额。充值在「我 → 钱包」 |
| `favorites` | `id` | sessionId, savedAt | 收藏的消息条目,字段 sessionId / msgId / actionIdx / savedAt / note。bubble menu「收藏」存入这里,「我 → 收藏」浏览 |
| `schedule` | `id` | startTs, characterId | 行程条目,字段 who(`user`/`character`)/ characterId(who=character 时)/ startTs / endTs / title / desc / `syncToChat`(默认 true,可关掉单条不注入)/ createdAt。在 [now-6h, now+24h] 窗内被注入 system prompt 的「# 当前行程」段;受 `settings.syncScheduleToChat` 全局开关 + 单条 `syncToChat` 双重门控 |
| `homeWidgets` | `id` | createdAt | 用户添加的桌面装饰,字段 type(`favorites`/`image`/`note`/`polaroid`/`anniversary`/`music`)/ data(base64 或文本或对象,按 type)/ **row / col / colSpan / rowSpan**(unifiedGridV1 后的位置,inline `grid-column / grid-row` 渲染)/ `transparency?`(0-100,默认 100,渲染为 `--widget-alpha`)/ createdAt。**只在 page 0 显示**(数据模型没 page 字段)。**legacy `size / placement / order` 字段** migration 跑过后已转成 row/col + widgetSpan,但 `widgetSpan()` 里仍有按 type 兜底分支防御老数据 |
| `cameras` | `id` | characterId | 监控机位,字段 characterId / room / `angle?`(可选,镜头朝向描述) / mode(`open`/`spy`) / `feedToChat`(默认 false,可单台开同步) / createdAt / `discoveredAt`(spy 被察觉时写入,null 表示未被察觉)/ `viewChangedAt?`(换机位或转动镜头时写入,monitor-view 渲染时过滤 createdAt < 这个值的旧 activityLog,数据保留但 UI 隐藏)。feedToChat 开 + `settings.syncMonitorToChat` 全局开 → 该角色最近一条 activityLog 注入 system prompt 的「# 角色当前活动」段(纯第一人称事实陈述,不提镜头 — 铁律 9) |
| `activityLog` | `id` | cameraId, characterId | 监控快照历史,字段 cameraId / characterId / sessionId? / `payload: {location, posture, activity, mood, caption, noticed, outOfReach?}` / createdAt。每次刷新画面 append 一条,**每台机位只保留最近 50 条**(`ACTIVITY_LOG_KEEP` in surveillance.js),写一条 prune 一次,IDB 不会无限涨 |
| `bottles` | `id` | status, castAt | 漂流瓶(网络隐喻,不是物理瓶子),字段 content / authorIsUser / audience(`contacts`/`strangers`) / status(`drifting`/`replied`/`read`) / replierCharacterId?(contacts 模式回信的角色 id) / generatedPersona?({name,persona,vibe,avatar?})(strangers 模式现造的人格) / reply? / castAt / replyDueAt? / repliedAt? / promotedCharacterId?。一瓶一回,要续聊走 `promoteStrangerToFriend` 升格成正式 character |
| `timeline` | `id` | sessionId | 每会话每天一句话总结(用户翻看用,**不进 system prompt**)。字段 sessionId / dayKey(`YYYY-MM-DD` 或 `start~end` 合并行) / summary(≤40 字) / `mergedFrom?[]`(合并行上记录原始 id) / `mergedInto?`(原始行上记录被合到哪一条) / createdAt。懒生成(打开时间线 tab 才扫描缺失),今天不生成,每 dayKey 只生成一次;`memory-manage` 页加了「时间线」tab 管理 |
| `milestones` | `id` | dayKey, characterId | 用户手动标的纪念日。字段 dayKey(`YYYY-MM-DD`) / title / desc? / `recurring?`(每年同月日高亮) / characterId?(关联角色)/ createdAt。挂在独立「记忆 app」里(home 第二页),不进 system prompt,只用于月历视图 + 列表 |
| `embeddings` | `id` | sessionId, sourceId | 向量记忆。字段 sourceType(`memory`/`msg`) / sourceId / sessionId / vector(`Float32Array`,IDB 直接 structured-clone 存原生数组) / dim / modelName / createdAt。每条 memory 生成时 fire-and-forget embed 一次,`requestReply` 时把最近 5 条对话拼成 query → cosine top-K(阈值 ≥ 0.35,默认 K=5)→ 注入 system prompt 的「# 相关记忆(按语义检索)」段。默认关,在 设置 → 向量记忆 启用 |

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

---

### TODO 待办

**等用户文案 / 决策**:
- 桌宠 `BEAR_PERSONA` + `AMBIENT_LINES` 7 场景(每个 1 条占位)、`bottle.js` 4 处 TODO、`KEEPSAKE_SYS_TEMPLATE`、`BEHAVIOR_GUIDANCE`(目前只有心声一段,9 个动作的「什么时机用」都没写)
- 行程 3 天时间轴美化风格(国誉手账本,等 user 给 reference)
- 监控反向注入聊天(user 在想 — 因为不只是当前帧,可能要包括历史画面)
- 网站地址 / KKphone.com(等 user 买域名,有了我加 CNAME 文件)
- 红包动画(user 明确不做)
- `state` 数值化动作(user 明确**绝对不要**)

**记忆架构 Phase 2+**:
- 阶段 2 用户画像 per (角色×人设) — 压缩 prompt 同时吐画像 patch,inject system prompt 顶部
- 阶段 4 向量打标(转折点/情感/日常)+ `buildVectorRecallLines` boost

**永远会做的小事**:
- 位置功能进阶(地图选点)

### Phase 2(MVP-2)
- **群聊**:`chatSessions.participantIds[]` 字段、群里「谁该说话/什么时机说」机制(导演 + 演员两层 — 第一层轻量导演选 speakers,第二层每个 speaker 走现有单角色管线)。新建对话 modal 入口已预留(`new-group` 按钮,目前 alert 占位);action schema 已加可选 `from` 字段(单聊省略、群聊角色名)
- `state` 动作做成可选开关,设置里开启后 prompt 才要求模型输出
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
- GitHub Pages 给最终用户:push 后 Pages 自动更新,用户刷新拿新版。
- 本仓库 git config(local):`user.name=Kyuu`,`user.email=252411668+Kyuuuuuovo@users.noreply.github.com`

---

## 给将来的我

如果用户提出某个新功能,**先确认它是不是违反「铁律 3」**(在 prompt 里加行为引导)。如果是,推回去——用 `character.persona` 表达,不要碰 `OUTPUT_FORMAT_SPEC`。

如果用户加 UI 元素,**先看是不是能 fit 进现有的 `.icon-btn` / `.attach-item` / `.bubble` / `.settings-item` 等已有视觉单元**。能用已有的就别造新的。

如果用户问「能不能加上某种 emoji 占位」**第一反应是问问要不要做成 SVG**——这个项目里 emoji 用在 `attach-item` 这种"以后会扩展"的位置,正式视觉用 SVG。
