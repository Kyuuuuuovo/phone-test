// IndexedDB wrapper. All methods async, Promise-based.
// Data model frozen in STORES below — bump DB_VERSION when changing schema.

export const DB_NAME = 'phone-app';
export const DB_VERSION = 8;

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
  // Timeline — per-session one-line-per-day summaries. Separate from
  // `memories` (which feeds the model); timeline is for the USER to skim.
  // Fields: id, sessionId, dayKey ('YYYY-MM-DD' or 'start~end' for merges),
  // summary (≤40 chars), mergedFrom?[] (ids on a merged row),
  // mergedInto? (id on originals that have been merged), createdAt.
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
