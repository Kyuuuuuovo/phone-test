# phone-app

纯前端 SPA 角色扮演手机 app。所有 JS 在浏览器执行,数据存 IndexedDB,AI 走用户自填的 OpenAI 兼容 endpoint。**作者不维护任何后端**。最终分发形态:GitHub Pages 静态托管。

---

## 当前状态(MVP-2 中 — 多 app 框架 + 钱包/收藏/行程/装饰位)

### 后端核心(`src/core/`)

- `db.js` —— IndexedDB 封装。`STORES` 常量是数据模型唯一来源。改动需 bump `DB_VERSION`。当前 `DB_VERSION = 4`。导出 `init / get / set / getAll / query(store, indexName, value) / del / clear / newId`。
- `context.js` —— `buildSystemPrompt(sessionId)`(13 段拼接,见函数注释)、`buildMessageHistory(sessionId, maxRecent=40)`、`maybeCompressMemory(sessionId)`(无 threshold 参数;读 `settings.memoryEnabled / memoryThreshold`,默认 enabled + 20);prompt 第②层「当前状态」会自动注入 `# 当前行程`(`buildScheduleLines` 在 [-6h, +24h] 窗内挑相关行程,user 全注 + character 仅当前会话角色)。
- `ai.js` —— `callAIOnce / callAI / requestReply` 三层。tool calling 支持 `get_current_time` / `get_weather` / `get_location`(按 chatSessions 的 toggle 启用)。`requestReply` 在末尾调一次 `maybeCompressMemory`。
- `weather.js` —— 用户填 URL 模板 + key 的统一接口,响应原文 ≤1500 字传给 AI 自己解析(`PRESET_TEMPLATES` 是 3 个一键预设按钮)。
- `theme.js` —— 单一活动主题。`DEFAULT_THEME` / `FONT_OPTIONS` / `GLASS_OPTIONS` / `TEXTURE_OPTIONS` / `THEME_PRESETS`(内置 + 用户保存)。`applyTheme()` 把字段写成 `:root` CSS 变量 + `body.dataset.fx-*` 属性,所有页面联动。
- `modal.js` —— 通用页内 modal helper(`openModal(container, {title, fields, submitLabel})`),代替 `window.prompt()`。chat / wallet 都用。
- `router.js` —— 页面栈。`setContainer / registerPage / navigate / back`。

### UI(`src/features/`)

- 全局壳:`.phone-frame` 用 `clamp(400px, calc((100vh - 24px) * 9 / 19.5), 480px)` 自适应桌面比例 + `align-items:center` 居中。状态栏:时间 + 4 根渐高竖线信号 SVG + 电池(`navigator.getBattery()`)。
- **首页 (`home`)** —— 2 页:
  - 第 1 页:角色 / 世界书 / 人设 / 行程 + 装饰位(图片 / 便签 widget,`homeWidgets` store;widget 有 `size`(small/medium/large)+ `placement`(above/below tiles))+ 收藏 widget(自带)+「＋ 添加装饰」按钮
  - 第 2 页:日记 / 推特 / 论坛 / 商城 / 监控(都是占位,点击 alert「还没做完」)
  - Dock:**微信** / 设置
  - 整页 `overflow-y: hidden`,装饰物高度自适应不下滑
- **微信壳 (`messaging`)** —— 4 个底 tab:
  - **消息**(嵌入 chat-list,可右键弹菜单 置顶/拉黑/删除)
  - **通讯录**(按拼音排 + 首字母分组,collator probe;右上 + 走 openNewChatModal)
  - **朋友圈**(占位)
  - **我**(profile + 钱包余额 / 当前人设 / 收藏入口)
- **聊天页**:msg-row(头像 + 气泡组 + 已读标);时间分隔条(>5 分钟自动插);
  attach-panel(语音 / 图片 / 红包 / 转账 / 位置 — 都用 in-frame modal 收集输入);
  bubble menu(右键 / 长按 500ms):引用 / 复制 / 收藏 / 删除;
  ⋯ 更多 → `chat-info`(置顶 toggle / 显示已读 toggle / 会话设置 / 聊天美化 / 记忆总结 / 编辑角色 / 清空 / 拉黑)
- 已注册路由 (~30 个):
  - `home / settings / settings-api / settings-api-detail / settings-weather / settings-theme / settings-memory / settings-data / settings-clear`
  - `messaging / chat-list / chat / chat-info / chat-beautify / chat-settings / memory-manage`
  - `character-list / character-detail / worldbook-list / worldbook-detail / persona-list / persona-detail / persona-pick`
  - `wallet / favorites-list / schedule`

---

## 数据模型(`db.js` STORES,DB_VERSION = 4)

| store | 主键 | 索引 | 说明 |
|---|---|---|---|
| `characters` | `id` | — | 角色,字段 name / persona / avatar / notes / blocked / **chatBackground**(per-character 聊天背景 base64)/ **chatFontSize**(per-character 字号覆盖,null 表示跟随全局)/ createdAt / updatedAt |
| `worldbooks` | `id` | — | 世界书容器(只有元数据) |
| `worldbookEntries` | `id` | worldbookId | 条目,字段 title / content / enabled / `position` / createdAt。`position` 三档:`before`(角色设定前)/ `inline`(角色设定后,默认)/ `after`(用户人设后)。**title 只是用户索引,不进 prompt;只 content 会被注入。** 同 position 内按 createdAt 升序排 |
| `characterWorldbooks` | `id` | characterId, worldbookId | 多对多关系表,字段 priority |
| `personas` | `id` | — | 玩家人设库 |
| `chatSessions` | `id` | characterId, lastMessageAt | 字段 characterId / personaId / title / createdAt / lastMessageAt / **isPinned** / `showReadReceipts`(默认 true)/ `readReceiptUpToTs` / `memoryPromptOverride`;会话感知 toggle:`{char,user}TzEnabled` / `*WeatherEnabled` / `*LocEnabled` + `*CityMode` / `*CityKey` / `*CityLabel` |
| `chatMessages` | `id` | sessionId, createdAt | role(`user`/`character`/`system`)/ **actions[]** / createdAt |
| `memories` | `id` | sessionId | 长对话压缩摘要,字段 sessionId / summary / fromMsgId / toMsgId / createdAt |
| `apiConfig` | `id` | — | 多条;每条 id / name / apiUrl / apiKey / modelName / temperature。当前活跃由 `settings.activeApiConfigId` 指 |
| `settings` | `id` | — | 单例 id=`default`。字段:`theme`(对象,见 [core/theme.js](src/core/theme.js))/ `themePresets[]` / `wallpaper`(base64 桌面壁纸)/ `activeApiConfigId` / `activePersonaId`(新建会话用)/ `weatherApi: {urlTemplate, apiKey}` / `memoryEnabled`(默认 true)/ `memoryThreshold`(默认 20)。`humanizerPrompt` 字段已废弃,在 `src/core/humanizer.js` 常量里 |
| `wallet` | `id` | — | 单例 id=`default`,字段 balance。用户发红包/转账扣余额,领 AI 红包/转账加余额。充值在「我 → 钱包」 |
| `favorites` | `id` | sessionId, savedAt | 收藏的消息条目,字段 sessionId / msgId / actionIdx / savedAt / note。bubble menu「收藏」存入这里,「我 → 收藏」浏览 |
| `schedule` | `id` | startTs, characterId | 行程条目,字段 who(`user`/`character`)/ characterId(who=character 时)/ startTs / endTs / title / desc / createdAt。在 [now-6h, now+24h] 窗内被注入 system prompt 的「# 当前行程」段 |
| `homeWidgets` | `id` | createdAt | 用户添加的桌面装饰,字段 type(`image`/`note`)/ data(base64 或文本)/ size(`small`/`medium`/`large`)/ placement(`above`/`below`)/ createdAt |

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

### 下一轮 follow-up(明确知道要做)
- **桌面装饰拖拽重排** —— 现在 `homeWidgets` 用 createdAt 排 + `placement: above/below` 两档。要做拖拽改变顺序 / 移动到另一格(Pointer Events 实现,grid sortable)
- **首页 app-icon 顺序也能改** —— 用户在 PAGES[0] 内拖拽 4 个 app icon 重排;改完存到 `settings.tileOrder[]`,home.js 渲染时读取
- **红包/转账细节** —— 动画(打开红包翻转)、详情页(来自谁/几号/几点)、AI 自动接收用户红包(模型在收到时下一轮 reply 标 `claimed`)
- **位置功能进阶** —— 现在是纯展示卡片,以后可以做地图选点 + 经纬度

### Phase 2(MVP-2)
- **群聊**:`chatSessions.participantIds[]` 字段、群里「谁该说话/什么时机说」机制(玩家@还是 AI 自决)
- `state` 动作做成可选开关,设置里开启后 prompt 才要求模型输出
- **环境上下文扩展**(按铁律 12 模板):
  - **监控**(「角色此刻在干嘛」):点开时基于当前时间 + 角色 schedule + persona 现生成,存到 `activityLog` store,prompt 注入「# 角色当前活动」
  - **角色当前活动主动注入**(可选 toggle):跟行程合并,prompt 第②层多一段

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
