# 记忆 app · 5 种视觉风格指令文档

目标:`src/features/memory/memory-app.js` 已有的 4-tab 结构(月历 / 时间线 / 总结 / 纪念日)在不动数据和交互的前提下,可以一键切换 5 种视觉风格,仅 CSS 层差异。给用户一个"今天我想用哪种皮肤翻记忆"的可玩性,同时为后面的「主题色 + 字体」体系扩出统一插槽。

---

## 通用架构(5 风格共享)

### 不动的部分

- **数据流**:`db.getAll('timeline' / 'memories' / 'milestones')` + 角色过滤 + topK 向量召回 — 跟现在完全一致。
- **交互流程**:顶部角色选择器(横向 chip 或纵向文件夹列表,取决于风格)→ 二级子导航(总览 / 时间线 / 总结 / 纪念日)→ 内容区。tab 切换 + 月历翻页 + 点格子弹 modal 等 wire 行为完全保留。
- **JS 文件结构**:`memory-app.js` 不拆。新增的风格仅是 `<body data-mem-style="planner|cabinet|petal|film|cosmic">` 一个 dataset 属性切换,所有规则都用 `body[data-mem-style="..."] .ma-...` 前缀作用域。
- **风格选择持久化**:`settings.memoryStyle`,默认 `planner`,在记忆 app 顶部右上角 chevron icon 弹下拉切换。

### 每张记忆卡片(无论哪种风格)必须显示

1. **tier 标签** — L1 近期 / L2 远期(`memories.tier` 决定)。
2. **时间覆盖范围** — `fromTs–toTs` 转成 `M月D日–M月D日`(单天就显示一行)。
3. **向量相关度分数** — topK 召回的余弦相似度,渲染为百分比 `87%`。
4. **标签** — 情感 / 日常 / 转折等,来自向量检索命中的分类。**该分类字段尚不存在**,待 Phase 4 `embedding.tags` 落地后填实;现在先在卡片预留 `.mem-card-tags` 容器,空数组时 CSS `:empty` 隐藏。

### 「总结」tab 顶部额外区块

- 名字:**语义检索命中**(`.mem-vector-hits`)。
- 内容:用最近 5 turns 拼成 query,取 topK ≥ 0.35 阈值的命中,展示分数和标签 chip。
- 点击命中条 → 高亮(不滚动)对应的 memory row,便于看上下文。

### 角色选择器两种形态(按风格不同选用)

- **横向 chip**(planner / petal / film / cosmic):圆角胶囊,可横向滚动。
- **纵向文件夹列表**(cabinet):左侧 4px 色条 + 角色名 + 计数信息 + 右箭头。

---

## 风格 1 · 手账本(planner)

### 关键词
手写感、纸质感、温暖。

### 实现要点

**背景**
```css
body[data-mem-style="planner"] .memory-app-page {
  background:
    repeating-linear-gradient(transparent 0, transparent 27px, rgba(120, 80, 40, 0.12) 27px, rgba(120, 80, 40, 0.12) 28px),
    #f9f3e7;
}
```
横线条纹纸,28px 行距。

**记忆卡片**
- **无边框**,只有左侧 3px 竖条 `border-left: 3px solid var(--accent-warm)`。
- 圆点时间轴标记:`::before` 伪元素,`width:8px / height:8px / border-radius:50% / background:var(--accent-warm) / position:absolute / left:-5.5px / top:18px`。

**子导航**
活页夹标签造型:平时 `border:1px dashed var(--border-dim)` + `border-bottom: none`,选中态 `border-style: solid` + `background: #fff` + `box-shadow: 0 -2px 0 var(--accent-warm) inset`。

**统计信息条**
"纸胶带"样式:
```css
.mem-stats-tape {
  transform: rotate(-1.2deg);
  background: linear-gradient(135deg, rgba(255, 220, 150, 0.6), rgba(255, 200, 130, 0.4));
  border-top: 1px dashed rgba(150, 100, 50, 0.4);
  border-bottom: 1px dashed rgba(150, 100, 50, 0.4);
  padding: 6px 12px;
}
```

**月历打卡圆点 → 方形**
`border-radius: 4px`,模拟手账打勾格(`.ma-cell-dots .dot { border-radius: 4px }`)。

---

## 风格 2 · 档案柜(cabinet)

### 关键词
整洁、归档、系统化。

### 实现要点

**角色选择器(覆盖通用形态)**
纵向文件夹列表,**替代横向 chip**:
```css
.mem-folder-list .mem-folder {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-left: 4px solid var(--folder-color);  /* 每角色不同色 */
  background: #fff;
  border-bottom: 1px solid var(--border-dim);
}
.mem-folder::after { content: '›'; margin-left: auto; opacity: 0.5; }
.mem-folder-count { margin-left: 8px; font-size: 12px; opacity: 0.6; }
```

**子导航**
胶囊容器内嵌 pill:
```css
.ma-tabs {
  background: var(--bg-dim);
  border-radius: 999px;
  padding: 3px;
  display: inline-flex;
}
.ma-tab { border: none; border-radius: 999px; padding: 6px 14px; }
.ma-tab.active {
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
```

**记忆卡片**
- **方角**:`border-radius: 4px`。
- 顶部 3px 渐变色条:`::before` 伪元素,`background: linear-gradient(90deg, var(--accent), var(--accent-dim))`。

**file-label 小标签**
```css
.mem-card-filelabel {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 10px;
  background: var(--accent);
  color: #fff;
  padding: 2px 8px;
  font-weight: 700;
}
```

---

## 风格 3 · 花瓣(petal)

### 关键词
柔软、有机、梦幻。

### 实现要点

**背景**
两个大面积径向渐变光斑:
```css
background:
  radial-gradient(ellipse 60% 50% at 20% 10%, rgba(255, 200, 220, 0.4), transparent 70%),
  radial-gradient(ellipse 70% 60% at 80% 90%, rgba(220, 200, 255, 0.4), transparent 70%),
  #fef9fb;
```

**全居中**
所有 `.ma-tab-body`, `.ma-list`, `.mem-card-meta` 等用 `text-align: center` + `align-items: center`。

**记忆卡片**
毛玻璃效果:
```css
border-radius: 20px;
background: rgba(255, 255, 255, 0.55);
backdrop-filter: blur(6px);
-webkit-backdrop-filter: blur(6px);
border: 1px solid rgba(255, 255, 255, 0.7);
```
右上角花纹装饰:`::after { content: '❀'; position: absolute; top: 8px; right: 12px; opacity: 0.12; font-size: 28px; }`

**子导航**
毛玻璃 pill,选中态:
```css
.ma-tab.active {
  background: linear-gradient(135deg, #ffc8d8, #d8c8ff);
  color: #fff;
  box-shadow: 0 2px 12px rgba(255, 200, 220, 0.5);
}
```

**段落分隔线**
```html
<div class="mem-divider"><span></span><i>·</i><span></span></div>
```
```css
.mem-divider { display: flex; align-items: center; gap: 8px; }
.mem-divider span { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--border-dim), transparent); }
.mem-divider i { font-size: 12px; opacity: 0.5; font-style: normal; }
```

---

## 风格 4 · 胶片(film)

### 关键词
复古、胶片质感、影像记忆。

### 实现要点

**角色头像**
方形 + 拍立得白色粗边框:
```css
.mem-char-avatar {
  border-radius: 4px;
  border: 6px solid #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}
```

**子导航**
制表符样式,**只有底部 2px accent 线**:
```css
.ma-tabs { border-bottom: 1px solid var(--border-dim); }
.ma-tab { border: none; background: none; padding: 8px 14px; }
.ma-tab.active { border-bottom: 2px solid var(--accent); margin-bottom: -1px; }
```

**记忆卡片**
- **极小圆角**:`border-radius: 2px`。
- 顶部 6px 胶片齿孔条纹:
```css
.mem-card::before {
  content: '';
  display: block;
  height: 6px;
  background: repeating-linear-gradient(90deg, #2a2a2a 0, #2a2a2a 4px, #fff 4px, #fff 8px);
}
.mem-card-inner { padding: 12px; }  /* 隔开齿孔条纹 */
```

**日期小标签**
```css
.mem-card-date {
  font-family: 'Menlo', 'Consolas', monospace;
  background: #2a2a2a;
  color: #fff;
  padding: 2px 6px;
  font-size: 11px;
}
```

---

## 风格 5 · 星河(cosmic)

### 关键词
深邃、星空、安静浪漫。

### 实现要点

**整个 phone 容器切换深色**
```css
body[data-mem-style="cosmic"] .phone-frame {
  background: linear-gradient(180deg, #1a0e14 0%, #3d2530 100%);
  color: #f8e0e8;
}
```

**星点背景**
```css
body[data-mem-style="cosmic"] .memory-app-page {
  background:
    radial-gradient(1px 1px at 20% 30%, rgba(255, 230, 200, 0.8), transparent),
    radial-gradient(1px 1px at 60% 70%, rgba(255, 220, 240, 0.6), transparent),
    radial-gradient(2px 2px at 80% 20%, rgba(255, 200, 220, 0.7), transparent),
    radial-gradient(1px 1px at 40% 90%, rgba(220, 200, 255, 0.5), transparent),
    transparent;
}
```
多打几组(8-12)做出星点分布感。

**文字色板**
浅粉 `#f8e0e8` / 浅金 `#ffe8c8` / 半透明粉 `rgba(255, 200, 220, 0.7)`。

**记忆卡片**
```css
.mem-card {
  background: rgba(60, 30, 50, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 200, 220, 0.2);
  border-radius: 12px;
}
.mem-card:hover {
  border-color: rgba(255, 200, 220, 0.6);
  box-shadow: 0 0 20px rgba(255, 180, 220, 0.25);
}
```

**glow-line 分隔**
```css
.mem-divider span {
  background: linear-gradient(90deg, transparent, rgba(255, 200, 220, 0.4), transparent);
}
```

**时间轴发光圆点**
```css
.mem-timeline-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffd4e0;
  box-shadow: 0 0 8px rgba(255, 180, 220, 0.8);
}
```

**标签 chip**
所有 tag chip 切换为暗底发光色:
```css
.mem-card-tags .tag {
  background: rgba(255, 200, 220, 0.15);
  color: #ffd4e0;
  border: 1px solid rgba(255, 200, 220, 0.3);
}
```

---

## 落地步骤

1. **抽离卡片渲染逻辑** — 现在 `memory-app.js` 里时间线 / 总结的 `.ma-row` 各自渲染,把它们统一成 `renderMemCard(item, kind)` 返回带 `.mem-card` 类的 HTML 模板。所有 5 风格共享这套结构,只换 CSS。
2. **加 dataset 切换** — 在 `mountMemoryApp` 开头读 `settings.memoryStyle`,写到 `document.body.dataset.memStyle`;离开 app 时 `cleanup` 清掉。
3. **加风格切换 UI** — header 右上角加 chevron icon,点开下拉(5 个 radio + preview 小卡)。`settings.memoryStyle` 更新,re-render。
4. **写 CSS** — 新建 `src/styles/memory-styles.css`,5 个 `body[data-mem-style="..."]` 作用域块。`base.css` 不动。
5. **预留 tag 容器** — `.mem-card-tags`(`:empty` 隐藏),等 Phase 4 向量打标落地后填入。
6. **预留 vector hits 区块** — `.mem-vector-hits` 容器先建,等数据接通再渲染。
