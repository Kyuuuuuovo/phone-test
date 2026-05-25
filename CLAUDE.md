# phone-app

纯前端 SPA 角色扮演手机 app。所有 JS 在浏览器执行,数据存 IndexedDB,AI 走用户自填的 OpenAI 兼容 endpoint。**作者不维护任何后端**。最终分发形态:GitHub Pages 静态托管。

---

## 当前状态(MVP-1 后端完整 + UI 基础完成)

### 后端核心(`src/core/`)

- `db.js` —— IndexedDB 封装。`STORES` 常量是数据模型唯一来源。改动需 bump `DB_VERSION`。导出 `init / get / set / getAll / query(store, indexName, value) / del / clear / newId`。
- `context.js` —— `buildSystemPrompt(sessionId)`(组装 character + 世界书条目 + persona + memories + 输出格式约束),`buildMessageHistory(sessionId, maxRecent=40)`(OpenAI-style messages),`maybeCompressMemory(sessionId, threshold=40)`(长对话压成 summary 写入 memories,删原消息)。
- `ai.js` —— `callAI({systemPrompt, messages, temperature})` POST 到 `apiConfig.apiUrl/chat/completions`;`parseActions(rawText)` 容忍 ` ```json ` fence + 包围文本;`dispatchActions(actions, ctx)` 走 handler 注册表,**未知 type 是 no-op**;`requestReply(sessionId)` 高层编排(context → callAI → parseActions → 写 chatMessage + 更新 lastMessageAt → dispatchActions)。
- `router.js` —— 简单页面栈。`setContainer / registerPage(id, mountFn) / navigate(id, params) / back()`。`mountFn(container, params, routerApi)` 返回 teardown 函数。

### UI(`src/features/`)

- 全局壳在 `main.js` 的 `renderShell()`:`.phone-frame`(桌面下 480px 居中 + 阴影)+ `.status-bar`(时间自动每 30s 更新,电量接 `navigator.getBattery()` + 充电雷电图标,信号占位文本)+ `#page-container`
- 已注册路由:`home / settings / settings-api / settings-data / settings-clear / chat-list / chat`
- 聊天页:消息流(每条 `chatMessage.actions[]` 里每个 action 渲染一个气泡)/ 引用预览条 / 输入框 + 加号按钮 + 发送 + 让 AI 回复 / 推上来的 attach-panel(语音/图片 可用,位置/文件 占位) / 头部「⋯ 更多」菜单(置顶/清空/加黑名单) / 气泡长按 500ms 或右键 → 菜单(引用/复制/删除)

---

## 数据模型(`db.js` STORES,11 个 store)

| store | 主键 | 索引 | 说明 |
|---|---|---|---|
| `characters` | `id` | — | 角色,字段 name/persona/avatar/notes/createdAt/updatedAt |
| `worldbooks` | `id` | — | 世界书容器(只有元数据) |
| `worldbookEntries` | `id` | worldbookId | 条目,字段 title/content/order/enabled。**v1 全量常驻注入**,关键词触发字段(keys/position/depth)留空 |
| `characterWorldbooks` | `id` | characterId, worldbookId | 多对多关系表,字段 priority |
| `personas` | `id` | — | 玩家人设库 |
| `chatSessions` | `id` | characterId, lastMessageAt | 字段 characterId / personaId / title / createdAt / lastMessageAt / **isPinned** |
| `chatMessages` | `id` | sessionId, createdAt | 字段 role(`user`/`character`/`system`)/ **actions[]**(原始动作数组,UI 渲染时按 type 分发)/ createdAt |
| `memories` | `id` | sessionId | 长对话压缩出来的摘要,字段 summary/fromMsgId/toMsgId |
| `apiConfig` | `id` | — | 单例,id=`default`,字段 apiUrl/apiKey/modelName/temperature |
| `settings` | `id` | — | 单例,id=`default`,以后放 theme 等 |

---

## 动作协议 v1(MVP-1)

模型 system prompt 强制要求**只返回 JSON 数组**(`OUTPUT_FORMAT_SPEC` in `context.js`),每项是 `{type, ...}`。允许的 type:

- `text { content }`
- `reply { content, quoteMsgId }`
- `recall { targetMsgId? }`
- `image { description }` —— 用户上传时也可以 `src`
- `voice { content, duration? }` —— 用户发的语音是「文字内容 + UI 渲染成语音条」,不做真 TTS

**数量约束**:1-3 默认,最多 5。**只此而已,绝不在 prompt 里写行为引导**(见下面铁律 3)。

未来动作(Phase 2+):sticker / call / state(心理活动/好感度,做成可选开关) / poke / 转账 ...

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

---

## 路线图

### Phase 1.5(下一轮要做)
- 聊天列表**左滑手势**(Pointer Events 兼容触摸 + 鼠标拖拽)→ 露出「置顶 / 删除」操作
- **角色管理页**:增删改、人设编辑、头像、`character.blocked` 拉黑标记
- **世界书管理页**:增删改世界书 + 条目 CRUD + 角色挂载 UI
- **玩家人设管理页**

### Phase 2(MVP-2)
- **群聊**:`chatSessions.participantIds[]` 字段、群里「谁该说话/什么时机说」机制(玩家@还是 AI 自决)
- `state` 动作做成可选开关,设置里开启后 prompt 才要求模型输出

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
