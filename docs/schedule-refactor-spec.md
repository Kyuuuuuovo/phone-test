# 行程 app · 双模式重构 + 打卡集成 指令文档

把"月历 + 日视图"与"三日时间轴"合并到同一个 app,顶部 mode-toggle 切换;打卡作为日级别 boolean 标记一并归入行程域,在月历 dot + 三日列顶部摘要 两处嵌入。

---

## 设计判断(决策摘要)

### 为什么不二选一,要保留切换?

**月历 + 日视图** 解决 **规划 / 回顾** 类问题:"我某天有什么"、"上周做了什么"。 
**三日时间轴** 解决 **当下感知** 类问题:"接下来几个小时的密度和冲突"。 
苹果日历也是月视图和日视图共存而非替代关系 — 用户 mental model 已经习惯了。 
顶部 pill 切换,不增加导航层级。默认 `month-day`。 
持久化到 `settings.scheduleMode`,下次进 app 记住上次选的。

### 为什么打卡放在行程而不是记忆?

- 行程本身是 **「日级别事件」的容器**,打卡也是 **「日级别布尔标记」**,数据粒度天然匹配。
- 放进来后,月历能同时显示「行程 dot + 打卡 dot」,点开某天 = 「今天要做什么 + 今天打了什么卡」一站式查看。
- 记忆是 **回顾性** 的(总结 / 时间线 / 纪念日),打卡是 **当下操作性** 的 — 归行程更对。

---

## 数据模型

### 新 store 1:`checkinTypes`(打卡类型定义)

用户自定义的"我每天要打的卡"集合 — 名字、图标、目标频率。

```
{
  id, name, icon, color,
  targetFreq?: 'daily' | 'weekly:N',  // daily | weekly:3 (每周 3 次)
  reminder?: 'morning' | 'noon' | 'evening' | null,  // 预留 — 通知集成 Phase 2 再做
  createdAt
}
```

索引:无(全表扫,数量小,通常 < 20)。

### 新 store 2:`checkins`(实际打卡记录)

每次打卡一行。同一 type 同一 dayKey 唯一(IDB 不约束唯一,业务层 upsert)。

```
{
  id, typeId, dayKey ('YYYY-MM-DD'), checkedAt,
  note?, value?  // value 预留:支持"打了几次 / 多少分钟"这类轻量数据
}
```

索引:`typeId`,`dayKey`。

### DB_VERSION

`10 → 11`,在 db.js 加两个 store config,onupgradeneeded 自动建表。

---

## UI 重构

### 顶部 mode-toggle

```
[ 月历 + 日 ]  [ 三日 ]
```
pill 切换,选中态有 accent 底色。位置:`.page-header` 下面、`.page-body` 顶部第一行。

### 模式 A:`month-day`(默认)

#### 月历部分

复用 `memory-app.js` 的 `renderCalendar()` **设计** 但 **独立实例**(不要 import 函数,避免耦合 — 函数搬到 `src/core/calendar-grid.js` 共享更优,但 demo 阶段先各自实现一份)。

每个 cell 上现在显示:
- `<i class="dot sched">` — 该 dayKey 有 schedule entry(任意 who)
- `<i class="dot checkin done">` — 该 dayKey 打过卡(任意 type 至少一条)
- `<i class="dot checkin partial">` — 该 dayKey 部分类型打了卡(用 hue 区分)

颜色建议:
- sched dot: `var(--accent)` — 通用强调色
- checkin done dot: `#5ec97e` — 绿色
- checkin partial dot: `#e2b94a` — 黄色

#### 日详情区(`day-detail`)

点击 cell **不弹 modal,直接在月历下方展开一段**(累积体验比模态好):

```
─────────────────────
3 月 5 日 · 周二
─────────────────────

📅 行程
  09:00–10:30  开会(我)
  14:00        见朋友(我)

✓ 打卡
  [✓ 跑步]   [○ 看书]   [✓ 喝水 3/4]   [+ 添加打卡]
```

- 行程行可点 → 进编辑 modal(复用现有 `openEditor`)。
- 打卡 chip 可点击 toggle 该 dayKey 该 type 的打卡状态。`○` → `✓` 写一行,反之删一行。
- `+ 添加打卡` → 弹 modal 让用户选已有 type / 新建 type。

#### 月历 + 日详情布局

`.page-body` 内,月历占上半,日详情占下半。日详情高度自适应,有 `max-height: 50vh` + `overflow-y: auto`。

### 模式 B:`three-day`(原 demo)

保留现有 `.schedule-3day-cols` 三列布局。

#### 每列顶部加一行紧凑打卡摘要

```
┌─────────────────────┐
│ 今天 · 3/5 周二     │
│ ✓✓○○○✓ (4/6 已打)  │
│─────────────────────│
│  0:00               │
│  ...                │
```

- 一排小圆点,每个 type 一个 — `✓` 已打 / `○` 未打 / 灰底 = 不在今天的 `targetFreq` 内。
- hover / 点击 → 展开同日详情区(或简单跳到 `month-day` 模式 + 选中该天?用户决定 — demo 阶段先做 hover tooltip,点击切模式 + 选中)。
- 占高约 36px,不影响 24h timeline 的总高 672px(`HOUR_PX = 28`)。

#### 修删除按钮

现在 `.time-entry` 渲染没画 `.entry-del` 按钮但 wire 里在找 — 长按 / 右键弹出操作菜单(删除 / 编辑)。具体:

`pointerdown` 600ms 长按 → 弹小菜单 `[ 编辑 | 删除 ]`,位置 follow 触点。
桌面 `contextmenu` 同效果。
mobile / 触屏统一用长按。

(简化:demo 阶段直接在 `.time-entry` 右上角加一个 12px 的 `×` 按钮 + 跟现有 `.entry-del` wire 对齐就行,长按菜单留作后续 polish。)

---

## 死代码清理

`schedule-list.js` 当前文件里:

- `bucketize(entries)` — 函数定义在文件尾,**没有任何调用**。删。
- `renderEntry(e, charMap)` — 同上,无调用。删。
- `.schedule-entry`、`.entry-time`、`.entry-body`、`.entry-title`、`.entry-who`、`.entry-desc`、`.entry-del` 等 CSS — 老布局用的,新双模式不再用。**保留 `.entry-del`** 给三日视图新加的删除按钮复用,其他可删 / 留作未来。

---

## buildScheduleLines 注入打卡

`src/core/context.js` 的 `buildScheduleLines` 末尾追加一段独立段落。

**注入策略 — 紧凑**(不啰嗦,避免 token 爆炸):

```
# 当前打卡(用户)

本月汇总:
- 跑步:已打 18/31 天
- 喝水:已打 27/31 天(连续 12 天)

近 7 天预测:
- 跑步:预计达成率 60%(目标每周 4 次,本周已打 2 次)
- 喝水:轨迹良好(目标每天)
```

**实现细则**:

- 受 `settings.syncScheduleToChat` 双重门控(打卡跟行程算一套上下文,不单设开关 — 也避免设置爆炸)。
- 仅 user 打卡,**character 没有打卡概念**。
- 数据计算:对每个 `checkinType` 跑两个查询:
  - 本月汇总:`checkins.dayKey` 落在本月窗口 + `typeId === t.id` 的行数 / 本月天数。
  - 连续天数:从今天往回扫,直到遇到一天没打,记录 streak。
- 注入位置:**作为独立段落**,附在原行程条目之后(同段 `# 当前行程` 的下方,新段 `# 当前打卡(用户)`),好让模型清楚区分"行程" vs "习惯"。
- 没有任何打卡 type 时整段不注入(`return ''`)。

---

## 落地步骤

1. **db.js** — 加 `checkins` + `checkinTypes` STORES,`DB_VERSION 10 → 11`。
2. **schedule-list.js 重构**:
   - 顶部加 mode-toggle pill。
   - `month-day` 模式:渲染月历 + 日详情区。
   - `three-day` 模式:保留现有时间轴 + 列顶加打卡摘要行 + 加删除按钮 wire。
   - 删 `bucketize()` / `renderEntry()`。
   - mode 切换写 `settings.scheduleMode`,re-render。
3. **CSS 新增**:
   - `.schedule-mode-toggle` pill。
   - `.schedule-cal-grid` / `.schedule-cell` / `.schedule-cell-dots`(月历部分,直接复用 ma-cal CSS 也可)。
   - `.day-detail-block`(展开区)。
   - `.day-col-checkins`(三日视图列顶摘要)。
   - `.time-entry-del`(三日视图删除按钮,12×12 右上角)。
4. **打卡 type 管理 modal** — 新建 type modal,字段:名字 / icon(emoji 输入即可) / 颜色 / 频率。可在月历日详情的 `+ 添加打卡` 入口弹。
5. **buildScheduleLines** 改 — 末尾追加打卡段。

---

## demo 阶段先做什么 / 后做什么

**demo 内必做**:
- 双模式切换 UI + 持久化
- 月历部分 + dot 渲染 + 日详情展开
- 三日视图列顶打卡摘要(可以先 fake 数据)
- 删除按钮修复
- 死代码清理
- `checkins` / `checkinTypes` 两个 store 落地
- 打卡 toggle 写入 IDB

**demo 后再做**:
- buildScheduleLines 注入打卡(用户先看 demo 体感,再决定要不要让 AI 看到)
- 打卡通知 / reminder
- 打卡数据可视化(连续天数图、月度热力图)
- type 排序 / 归档
