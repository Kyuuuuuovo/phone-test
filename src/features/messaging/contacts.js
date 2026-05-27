// Contacts tab inside the messaging shell. Lists characters that have at
// least one chat session — i.e. people the user has actually talked to.
// Tap a row → jump straight to the latest session with that character.
// Blocked characters are shown but visually muted.

import * as db from '../../core/db.js';

export async function mountContacts(container, params, router) {
  container.innerHTML = `<div class="contacts-body"></div>`;
  const body = container.querySelector('.contacts-body');

  const sessions = await db.getAll('chatSessions');
  // Group sessions by characterId; pick the most recent session per character
  // so a tap lands on the chat they last touched.
  const latestByChar = new Map();
  for (const s of sessions) {
    const cur = latestByChar.get(s.characterId);
    if (!cur || (s.lastMessageAt ?? 0) > (cur.lastMessageAt ?? 0)) {
      latestByChar.set(s.characterId, s);
    }
  }
  const charIds = Array.from(latestByChar.keys()).filter(id => id !== '__bear__');
  const chars = (await Promise.all(charIds.map(id => db.get('characters', id)))).filter(Boolean);

  const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });
  // Sort by pinyin (V8/Firefox use pinyin collation for zh-Hans-CN by default).
  chars.sort((a, b) => collator.compare(a.name || '', b.name || ''));

  if (chars.length === 0) {
    body.innerHTML = `<div class="empty-state">还没有联系人<br>去「消息」tab 新建一个对话</div>`;
    return () => {};
  }

  // Group by pinyin first-letter (or ASCII first-letter for non-CJK names).
  // For CJK, we probe the collator: a Chinese char belongs to letter L if it
  // sorts >= L and < L+1 in pinyin order. Works for ~95% of common chars; rare
  // / 多音字 may fall into an adjacent bucket — fallback to '#' if unmatched.
  const groups = new Map();
  for (const c of chars) {
    const key = firstLetter(c.name || '', collator);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  // Group keys ordered: A-Z then '#'
  const groupOrder = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
  const html = groupOrder
    .filter(k => groups.has(k))
    .map(letter => `
      <div class="contacts-group">
        <div class="contacts-letter">${esc(letter)}</div>
        ${groups.get(letter).map(c => `
          <button class="contact-row${c.blocked ? ' blocked' : ''}" data-char-id="${esc(c.id)}">
            ${renderAvatar(c)}
            <div class="contact-name">${esc(c.name || '(未命名)')}${c.blocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
          </button>
        `).join('')}
      </div>
    `).join('');
  body.innerHTML = html;

  const onClick = async (e) => {
    const row = e.target.closest('[data-char-id]');
    if (!row) return;
    const charId = row.dataset.charId;
    const s = latestByChar.get(charId);
    if (!s) return;
    router.navigate('chat', { sessionId: s.id });
  };
  body.addEventListener('click', onClick);

  return () => body.removeEventListener('click', onClick);
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="contact-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="contact-avatar">${esc(initial)}</div>`;
}

// Pinyin first letter via collator probing. For ASCII characters returns the
// uppercase letter directly; for CJK we find the position L such that
// L <= char < (L+1) in pinyin collation. Falls back to '#' for symbols /
// digits / chars the collator can't place.
// Why Chinese sentinels and not Latin A-Z —— Intl.Collator('zh-Hans-CN') 把所有
// CJK 字符排在 Latin Z 之后,所以 `compare(ch, 'A') >= 0 && compare(ch, 'B') < 0`
// 对任何中文都 false → 全部 fallback 到 '#',user 看起来"拼音排序不工作"
// (实际 sort 是对的,只是 group 全挤进一桶)。改成用每个拼音字母 group
// 的最早中文字符做哨兵(阿/巴/擦/答/...),compare 在 CJK 域内就正常了。
// 跳过 I/U/V — 标准汉语拼音里没有以这三个字母起头的辅音。
const PINYIN_SENTINELS = '阿巴擦答厄发噶哈击喀啦妈拿哦怕七然撒他挖西压杂';
const PINYIN_LETTERS   = 'ABCDEFGHJKLMNOPQRSTWXYZ';
function firstLetter(name, collator) {
  const ch = String(name).trim().slice(0, 1);
  if (!ch) return '#';
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  // For digits/symbols
  if (!/[一-鿿㐀-䶿]/.test(ch)) return '#';
  // CJK: probe against pinyin-letter sentinels
  for (let i = 0; i < PINYIN_SENTINELS.length; i++) {
    const lo = PINYIN_SENTINELS[i];
    const hi = i === PINYIN_SENTINELS.length - 1 ? '￿' : PINYIN_SENTINELS[i + 1];
    if (collator.compare(ch, lo) >= 0 && collator.compare(ch, hi) < 0) {
      return PINYIN_LETTERS[i];
    }
  }
  return '#';
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
