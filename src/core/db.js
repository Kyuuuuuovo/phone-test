// IndexedDB wrapper. All methods async, Promise-based.
// Data model frozen in STORES below — bump DB_VERSION when changing schema.

export const DB_NAME = 'phone-app';
export const DB_VERSION = 16;

// Object store definitions. Applied during onupgradeneeded.
// keyPath = primary key field; indexes = secondary lookup paths.
export const STORES = {
  characters: {
    keyPath: 'id',
    indexes: [],
  },
  worldbooks: {
    keyPath: 'id',
    indexes: [],
  },
  worldbookEntries: {
    keyPath: 'id',
    indexes: [
      { name: 'worldbookId', keyPath: 'worldbookId' },
    ],
  },
  characterWorldbooks: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
      { name: 'worldbookId', keyPath: 'worldbookId' },
    ],
  },
  personas: {
    keyPath: 'id',
    indexes: [],
  },
  chatSessions: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
      { name: 'lastMessageAt', keyPath: 'lastMessageAt' },
    ],
  },
  chatMessages: {
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  // 长对话压缩摘要。一次压缩可能产生 1-3 张「故事卡」,各占一行,共享 groupId
  // 方便一起 undo。字段:id / sessionId / tier (1=L1 近期 / 2=L2 远期) /
  //   title? / summary / quotes?: string[] / tag? (转折/亲密/冲突/发现/约定/日常) /
  //   importance? ('high'|'low',默认 low) / groupId? / fromMsgId / toMsgId /
  //   fromTs / toTs / createdAt。importance 只影响记忆 app 显示排序,两档都注入
  //   prompt(日常聊天大部分是 low,排除掉就没记忆了)。
  memories: {
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
    ],
  },
  apiConfig: { keyPath: 'id', indexes: [] },  // singleton, id='default'
  settings:  { keyPath: 'id', indexes: [] },  // singleton, id='default'
  wallet:    { keyPath: 'id', indexes: [] },  // singleton, id='default', fields: balance
  favorites: {
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'savedAt',   keyPath: 'savedAt' },
    ],
  },
  // Schedule entries — events for user or specific characters. Injected into
  // system prompt's 当前状态 layer when temporally near current time.
  schedule: {
    keyPath: 'id',
    indexes: [
      { name: 'startTs',     keyPath: 'startTs' },
      { name: 'characterId', keyPath: 'characterId' },
    ],
  },
  // User-placed decoration widgets on the home screen (images, notes).
  homeWidgets: {
    keyPath: 'id',
    indexes: [
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  // Surveillance cameras placed by the user. mode: 'open' (角色知道有摄像头)
  // or 'spy' (角色不知道). One row per (character, room, mode). discoveredAt
  // turns spy → exposed when the snapshot model returns noticed=true.
  cameras: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
    ],
  },
  // Snapshot history. Every camera refresh appends one row; payload holds
  // the structured fields the model returned (location/posture/activity/
  // mood/caption/noticed). Read latest by sorting on createdAt desc.
  activityLog: {
    keyPath: 'id',
    indexes: [
      { name: 'cameraId',    keyPath: 'cameraId' },
      { name: 'characterId', keyPath: 'characterId' },
    ],
  },
  // Drift bottles (漂流瓶). One reply per bottle, no threading.
  // Fields: id, content, authorIsUser (bool), audience('contacts'|'strangers'),
  // status ('drifting'|'replied'|'read'),
  // replierCharacterId (contacts mode) | generatedPersona ({name,persona,avatar?,vibe?}) (strangers mode),
  // reply (string), castAt, replyDueAt, repliedAt.
  // Indexed by status (cheap drifting-bottle scan) and castAt (sort newest first).
  bottles: {
    keyPath: 'id',
    indexes: [
      { name: 'status',  keyPath: 'status'  },
      { name: 'castAt',  keyPath: 'castAt'  },
    ],
  },
  // Timeline — per-session per-event timeline rows for the USER to skim.
  // Separate from `memories` (which feeds the model). 一天可以多条:同 dayKey
  // 出现多行,按 eventIdx 排序展示。
  // Fields: id, sessionId, dayKey ('YYYY-MM-DD' or 'start~end' for merges),
  //   summary (≤25 chars per event), eventIdx? (0-based,同 dayKey 内排序),
  //   fromTs? / toTs? (整天的时间窗,用于显示 HH:MM 段),
  //   mergedFrom?[] (ids on a merged row),
  //   mergedInto? (id on originals that have been merged), createdAt.
  // Indexed by sessionId so the list view + lazy-generation scan are O(rows-this-session).
  timeline: {
    keyPath: 'id',
    indexes: [
      { name: 'sessionId', keyPath: 'sessionId' },
    ],
  },
  // Milestones — user-marked important days. Shown in the memory app's
  // calendar / 纪念日 tab. Optional sessionId + characterId so a milestone
  // can be either global ("毕业") or tied to one relationship ("和小克说我喜欢ta").
  // Fields: id, dayKey ('YYYY-MM-DD'), title, desc?, type? ('anniversary' |
  // 'event' | 'milestone'), recurring? (bool — yearly), sessionId?,
  // characterId?, createdAt.
  // Indexed by dayKey so the calendar view can range-query a month at once.
  milestones: {
    keyPath: 'id',
    indexes: [
      { name: 'dayKey', keyPath: 'dayKey' },
      { name: 'characterId', keyPath: 'characterId' },
    ],
  },
  // Embeddings — per-source-row vector store for semantic retrieval.
  // Fields: id, sourceType ('memory'|'worldbook-entry'), sourceId (memoryId
  // or entryId), sessionId (null for worldbook-entry rows since worldbooks
  // attach to characters not sessions), vector (Float32Array —
  // structured-clone-safe in IDB), dim, modelName, createdAt.
  // Indexed by sessionId (per-session memory retrieval scope) and sourceId
  // (dedup-check when re-embedding) and sourceType (v16: world-book vector
  // recall used to db.getAll the whole table then filter sourceType, which
  // grows linearly with every session's accumulated memory vectors —
  // unbounded on heavy users; the index lets us pull only the rows we care
  // about per query).
  embeddings: {
    keyPath: 'id',
    indexes: [
      { name: 'sessionId',  keyPath: 'sessionId'  },
      { name: 'sourceId',   keyPath: 'sourceId'   },
      { name: 'sourceType', keyPath: 'sourceType' },
    ],
  },
  // 千纸鹤 / 叠星星 — 角色给 user 折的延迟揭晓信物。lazy 生成:user 出
  // 主题 + 数量,N 行 status='folded' 不调 API;点拆 → 调 API 生成 content
  // → status='opened';留下 → 'kept'(可反复重读);丢掉 → 数据库 hard delete。
  // 字段:characterId / type ('crane'|'star') / theme / status / content? /
  // createdAt / openedAt? / nth(这是第几颗,1-indexed,让生成时带"第 N 颗")
  keepsakes: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
      { name: 'status',      keyPath: 'status'      },
    ],
  },
  // 打卡类型 — 用户自定义的"每天要打的卡"集合。schedule app 用,跟 schedule
  // 平级但独立 store(打卡是 boolean 标记,schedule 是时段事件 — 数据形状
  // 不同)。字段:id / name / icon / color / kind?('normal' | 'period',默认
  // 'normal';'period' = 生理期特殊类型,UI 上单独 section + 预测窗口 + 通知)
  // / cycleConfig?(only when kind='period':{enabled, visibleToChat, averageLength,
  //   periodLength, fluctuation, lastStartDayKey, history}) / reminder? / createdAt。
  // 通常 < 20 行,无索引。
  checkinTypes: {
    keyPath: 'id',
    indexes: [],
  },
  // 每次打卡一行,同一 (typeId, dayKey) 业务层 upsert(IDB 不约束)。字段:
  // id / typeId / dayKey ('YYYY-MM-DD') / checkedAt / note? / value?(预留
  // 「打了几次 / 多少分钟」这类轻量数据)。按 typeId 和 dayKey 索引,月历视
  // 图能 O(month) 拉取当月某 type 的所有打卡。
  checkins: {
    keyPath: 'id',
    indexes: [
      { name: 'typeId', keyPath: 'typeId' },
      { name: 'dayKey', keyPath: 'dayKey' },
    ],
  },
  // 用户画像 — per (角色×人设) 的画像总结。id = composite `${charId}|${personaId}`
  // (personaId 为空 = "所有人设共享")。Lookup:context.buildUserProfileLine 先
  // 精确匹配 charId|sessionPersonaId,落空 fallback charId|(共享)。
  // 字段:characterId / personaId / likes / dislikes / discoveries(三段 textarea
  // 文本,3 段加起来 ≤500 字让 prompt 注入不爆)/ createdAt / updatedAt。
  userProfiles: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
    ],
  },
  // 生理期 周期 — 单例 id='default'。字段:
  //   enabled (bool, default false) / averageLength (天数, default 28) /
  //   periodLength (来潮持续天数, default 5) / fluctuation (前后浮动 ±N 天, default 2) /
  //   lastStartDayKey ('YYYY-MM-DD' or null) / history [{startDayKey, endDayKey?, note?}] /
  //   visibleToChat (bool, 是否注入 prompt, default false 双门控隐私安全)
  // 预测算法:nextStart = lastStartDayKey + averageLength;
  //   浮动窗口 [nextStart - fluctuation, nextStart + fluctuation]。
  // Prompt 注入只在「进行中」或「浮动窗口内」才发生 — 平日不生成噪音。
  cycle: {
    keyPath: 'id',
    indexes: [],
  },
  // 生理期 症状记录 — 独立 store,不复用 checkins(隐私敏感 + 跟体力打卡分离)。
  // 字段:id / dayKey ('YYYY-MM-DD') / kind ('cramp'|'headache'|'mood'|'flow'|'note') /
  //   severity? (1-3 轻中重) / note? (自由文本) / createdAt。按 dayKey 索引,
  //   月历视图按月范围扫,O(month)。
  cycleSymptoms: {
    keyPath: 'id',
    indexes: [
      { name: 'dayKey', keyPath: 'dayKey' },
    ],
  },
};

let _db = null;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

function store(storeName, mode = 'readonly') {
  if (!_db) throw new Error('db not initialized — call db.init() first');
  return _db.transaction(storeName, mode).objectStore(storeName);
}

export async function init() {
  if (_db) return _db;

  _db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction;
      for (const [name, config] of Object.entries(STORES)) {
        let s;
        if (db.objectStoreNames.contains(name)) {
          s = tx.objectStore(name);
        } else {
          s = db.createObjectStore(name, { keyPath: config.keyPath });
        }
        for (const idx of (config.indexes || [])) {
          if (!s.indexNames.contains(idx.name)) {
            s.createIndex(idx.name, idx.keyPath, idx.options || {});
          }
        }
      }
      // v1 → v2: apiConfig was a singleton (id='default'). Convert to multi-record,
      // give the existing one a name, and point settings.activeApiConfigId at it.
      if (event.oldVersion < 2) {
        migrateV1ToV2(tx);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror   = () => reject(open.error);
    open.onblocked = () => reject(new Error('db open blocked by another tab — close other tabs and retry'));
  });

  // Drop connection if another tab triggers an upgrade — lets them through cleanly.
  _db.onversionchange = () => { _db.close(); _db = null; };

  // Ask browser to keep IndexedDB durable under storage pressure. Non-fatal if denied.
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch (_) { /* ignore */ }
  }

  return _db;
}

export async function get(storeName, id) {
  return req(store(storeName).get(id));
}

export async function set(storeName, obj) {
  return req(store(storeName, 'readwrite').put(obj));
}

export async function getAll(storeName) {
  return req(store(storeName).getAll());
}

// Fetch all rows where indexName matches value (exact match).
export async function query(storeName, indexName, value) {
  return req(store(storeName).index(indexName).getAll(value));
}

export async function del(storeName, id) {
  return req(store(storeName, 'readwrite').delete(id));
}

export async function clear(storeName) {
  return req(store(storeName, 'readwrite').clear());
}

// Generate a key suitable for any store's `id` field.
export function newId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// Atomic settings update — opens a single readwrite tx, fetches the current
// row, passes it to `fn` (which mutates in place or returns a new object),
// and writes back in the same tx. Concurrent updateSettings() calls
// serialize through the IDB transaction queue, so there's no read/write
// race where two updates each load the pre-state and one's write clobbers
// the other.
//
// fn may be async — internally we use IDB request callbacks to keep
// everything inside the same transaction (any await would let the tx
// auto-commit). So fn should be sync; if you need async work, do it
// BEFORE calling updateSettings.
export async function updateSettings(fn) {
  if (!_db) throw new Error('db not initialized — call db.init() first');
  return new Promise((resolve, reject) => {
    const tx = _db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const getReq = store.get('default');
    getReq.onsuccess = () => {
      try {
        const current = getReq.result || { id: 'default' };
        const next = fn(current) || current;
        if (!next.id) next.id = 'default';
        store.put(next);
      } catch (e) {
        try { tx.abort(); } catch (_) {}
        reject(e);
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete  = () => resolve();
    tx.onerror     = () => reject(tx.error);
  });
}

// 整 store 替换 — clear + 所有 puts 在同一个 readwrite tx 内,要么全成要么
// 全失败。data-backup 导入用的:之前 `await db.clear() + for await db.set()`
// 不原子,中途崩了 store 半空,这个一次性保证。
export async function txnReplace(storeName, rows) {
  if (!_db) throw new Error('db not initialized — call db.init() first');
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('tx aborted'));
  });
}

// Atomic multi-store put — write a batch of rows in a single transaction.
// `plan` is { storeName: [rows], ... }. All writes commit together (or
// none, if any one fails). Use when a logical operation spans multiple
// stores and partial application would leave the DB inconsistent — e.g.
// the memory-archive batch in maybeCompressMemory (memory row +
// archived flags on N chatMessages must all land together).
export async function txnPut(plan) {
  if (!_db) throw new Error('db not initialized — call db.init() first');
  const stores = Object.keys(plan);
  if (stores.length === 0) return;
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(stores, 'readwrite');
    for (const name of stores) {
      const store = tx.objectStore(name);
      for (const row of plan[name]) store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// v1 → v2 data migration. Runs inside the versionchange transaction.
// Uses raw IDBRequest (not the async wrappers) because the tx is owned by onupgradeneeded.
function migrateV1ToV2(tx) {
  const apiStore = tx.objectStore('apiConfig');
  const settingsStore = tx.objectStore('settings');

  const getApi = apiStore.get('default');
  getApi.onsuccess = () => {
    const oldConfig = getApi.result;
    let newActiveId = null;
    if (oldConfig) {
      newActiveId = newId();
      apiStore.delete('default');
      apiStore.put({
        id: newActiveId,
        name: '默认',
        apiUrl:    oldConfig.apiUrl    || '',
        apiKey:    oldConfig.apiKey    || '',
        modelName: oldConfig.modelName || '',
        temperature: oldConfig.temperature ?? 0.8,
      });
    }
    const getSettings = settingsStore.get('default');
    getSettings.onsuccess = () => {
      const s = getSettings.result || { id: 'default' };
      if (!s.theme) s.theme = 'default';
      if (newActiveId) s.activeApiConfigId = newActiveId;
      else if (!s.activeApiConfigId) s.activeApiConfigId = null;
      settingsStore.put(s);
    };
  };
}
