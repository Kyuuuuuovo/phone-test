// Chat info page — opened by the chat header's "⋯ more" button.
// Replaces the inline dropdown. Acts like WeChat's "聊天信息" page.

import * as db from '../../core/db.js';
import * as context from '../../core/context.js';
import { openConfirm, openAlert } from '../../core/modal.js';
import { esc } from '../../core/util.js';

export async function mountChatInfo(container, params, router) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    container.innerHTML = `<div class="page"><div class="page-body">缺少 sessionId</div></div>`;
    return () => {};
  }
  const session = await db.get('chatSessions', sessionId);
  if (!session) {
    container.innerHTML = `<div class="page"><div class="page-body">会话不存在</div></div>`;
    return () => {};
  }
  const character = await db.get('characters', session.characterId);
  const isBlocked = !!character?.blocked;

  container.innerHTML = `
    <div class="page chat-info-page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">聊天信息</div>
      </header>
      <div class="page-body">
        <div class="chat-info-card">
          ${renderAvatar(character)}
          <div class="chat-info-name">${esc(character?.name ?? '(未知角色)')}${isBlocked ? ' <span class="blocked-badge">已拉黑</span>' : ''}</div>
        </div>
        <h3 class="settings-section-title">常用</h3>
        <div class="settings-list">
          <button class="settings-item" data-action="pin">
            <span class="settings-label">${session.isPinned ? '取消置顶' : '置顶聊天'}</span>
            <span class="settings-chevron">›</span>
          </button>
          <label class="settings-item toggle-row">
            <span class="settings-label">显示已读标记</span>
            <input type="checkbox" data-toggle="showReadReceipts"${session.showReadReceipts !== false ? ' checked' : ''}>
          </label>
          <label class="settings-item toggle-row">
            <span class="settings-label">显示头像</span>
            <input type="checkbox" data-toggle="showAvatars"${session.showAvatars !== false ? ' checked' : ''}>
          </label>
          <label class="settings-item toggle-row">
            <span class="settings-label">本地时间感知</span>
            <input type="checkbox" data-toggle="timeAwareness"${session.timeAwareness !== 'off' ? ' checked' : ''}>
          </label>
          <label class="settings-item toggle-row">
            <span class="settings-label">翻译模式
              <div class="settings-sub">允许角色用任意语言对话,非中文时自带中文翻译。点击原文气泡 → 下方展开翻译。</div>
            </span>
            <input type="checkbox" data-toggle="translateMode"${session.translateMode === true ? ' checked' : ''}>
          </label>
          <button class="settings-item" data-action="beautify">
            <span class="settings-label">聊天美化</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="character">
            <span class="settings-label">编辑角色资料</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>

        <h3 class="settings-section-title">扩展</h3>
        <div class="settings-list">
          <button class="settings-item" data-action="worldMode">
            <span class="settings-label">世界模式 · ${
              (session.worldMode ?? character?.worldMode) === 'fictional' ? '架空' : '现实'
            }</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="settings">
            <span class="settings-label">天气与时间感知</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="memory">
            <span class="settings-label">记忆总结</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>

        <h3 class="settings-section-title">数据</h3>
        <div class="settings-list">
          <button class="settings-item" data-action="export">
            <span class="settings-label">导出聊天数据</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item" data-action="import">
            <span class="settings-label">导入聊天数据</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>

        <h3 class="settings-section-title">危险</h3>
        <div class="settings-list">
          <button class="settings-item danger" data-action="clear">
            <span class="settings-label">清空聊天记录</span>
            <span class="settings-chevron">›</span>
          </button>
          <button class="settings-item${isBlocked ? '' : ' danger'}" data-action="block">
            <span class="settings-label">${isBlocked ? '解除拉黑' : '加入黑名单'}</span>
            <span class="settings-chevron">›</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const onToggle = async (e) => {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    const key = cb.dataset.toggle;
    const fresh = await db.get('chatSessions', sessionId);
    // timeAwareness 是 'on'(默认,undefined 也算 on) / 'off' 的 string,不是
    // bool 字段。其它 toggle 都是 bool 直接写 cb.checked。
    if (key === 'timeAwareness') {
      fresh.timeAwareness = cb.checked ? 'on' : 'off';
    } else {
      fresh[key] = cb.checked;
    }
    await db.set('chatSessions', fresh);
  };
  container.addEventListener('change', onToggle);

  const onClick = async (e) => {
    if (e.target.closest('.back')) return router.back();
    const item = e.target.closest('[data-action]');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'pin') {
      const fresh = await db.get('chatSessions', sessionId);
      fresh.isPinned = !fresh.isPinned;
      await db.set('chatSessions', fresh);
      item.querySelector('.settings-label').textContent = fresh.isPinned ? '取消置顶' : '置顶聊天';

    } else if (action === 'worldMode') {
      // 切换世界模式 — 同角色不同 session 可以独立选(现实 vs 架空)。
      // session 没显式 set 时 fallback 到 character.worldMode(legacy data
      // 兼容),最终 default 'real'。
      const fresh = await db.get('chatSessions', sessionId);
      const current = fresh.worldMode ?? character?.worldMode ?? 'real';
      const next = current === 'fictional' ? 'real' : 'fictional';
      const target = next === 'fictional' ? '架空' : '现实';
      const flavorMsg = next === 'fictional'
        ? '切到架空 — 后续这个会话不会注入真实时间/天气/位置,角色不会知道现实日期。'
        : '切到现实 — 后续注入真实时间 + 天气/位置工具。';
      if (!await openConfirm(container, {
        title: `切换到「${target}」?`,
        message: flavorMsg,
        confirmLabel: '切换',
      })) return;
      fresh.worldMode = next;
      await db.set('chatSessions', fresh);
      item.querySelector('.settings-label').textContent = `世界模式 · ${target}`;

    } else if (action === 'settings') {
      router.navigate('chat-settings', { sessionId });

    } else if (action === 'beautify') {
      router.navigate('chat-beautify', { sessionId });

    } else if (action === 'memory') {
      router.navigate('memory-manage', { sessionId });

    } else if (action === 'character') {
      router.navigate('character-detail', { id: session.characterId });

    } else if (action === 'export') {
      try {
        const payload = await buildSessionExport(sessionId);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const charName = (payload.character?.name || 'chat').replace(/[\\/:*?"<>|]/g, '_');
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.download = `phone-app-chat-${charName}-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await openAlert(container, { title: '已导出', message: `${payload.chatMessages.length} 条消息 + ${payload.memories.length} 条记忆` });
      } catch (e) {
        await openAlert(container, { title: '导出失败', message: String(e).slice(0, 200), danger: true });
      }

    } else if (action === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        if (!await openConfirm(container, {
          title: '导入对话',
          message: '导入会创建一个新对话(原数据不动)。继续吗?',
          confirmLabel: '导入',
        })) return;
        try {
          const newSid = await importSessionFromFile(file);
          await openAlert(container, { title: '导入成功', message: '即将跳到新会话。' });
          router.navigate('chat', { sessionId: newSid });
        } catch (e) {
          await openAlert(container, { title: '导入失败', message: String(e).slice(0, 300), danger: true });
        }
      }, { once: true });
      input.click();

    } else if (action === 'clear') {
      if (!await openConfirm(container, {
        title: '清空对话',
        message: '清空这个对话的所有消息和记忆?角色保留。',
        confirmLabel: '清空',
        danger: true,
      })) return;
      await db.deleteSessionCascade(sessionId);  // 含 favorites + embeddings,清空时一并清孤儿
      await openAlert(container, { title: '已清空', message: '会话的消息、记忆、时间线都清掉了。角色保留。' });

    } else if (action === 'block') {
      const fresh = await db.get('characters', session.characterId);
      if (!fresh) return;
      const goingToBlock = !fresh.blocked;
      if (goingToBlock && !await openConfirm(container, {
        title: '加入黑名单',
        message: `把「${fresh.name || '这个角色'}」加入黑名单?对话和消息会保留,AI 会通过 system prompt 知道这个状态,你可以随时解除。`,
        confirmLabel: '加入黑名单',
        danger: true,
      })) return;
      fresh.blocked = goingToBlock;
      fresh.updatedAt = Date.now();
      await db.set('characters', fresh);
      // Bounce back to chat to refresh the blocked banner.
      router.navigate('chat', { sessionId });
    }
  };
  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onToggle);
  };
}

function renderAvatar(c) {
  if (c?.avatar) {
    return `<div class="chat-info-avatar"><img src="${esc(c.avatar)}" alt=""></div>`;
  }
  const initial = (c?.name ?? '?').slice(0, 1);
  return `<div class="chat-info-avatar placeholder">${esc(initial)}</div>`;
}

// Bundle everything needed to recreate this session on another machine:
// the session row, all its messages + memories, the character (so the
// import doesn't require the same character to already exist), the persona
// (if bound), and any worldbooks mounted to that character (with entries
// and the link rows).
async function buildSessionExport(sessionId) {
  const session = await db.get('chatSessions', sessionId);
  if (!session) throw new Error('会话不存在');
  const chatMessages = await db.query('chatMessages', 'sessionId', sessionId);
  const memories     = await db.query('memories',     'sessionId', sessionId);
  const character    = session.characterId ? await db.get('characters', session.characterId) : null;
  const persona      = session.personaId   ? await db.get('personas',   session.personaId)   : null;
  const cwbRels = session.characterId
    ? await db.query('characterWorldbooks', 'characterId', session.characterId)
    : [];
  const worldbooks = [];
  const worldbookEntries = [];
  for (const rel of cwbRels) {
    const wb = await db.get('worldbooks', rel.worldbookId);
    if (wb) worldbooks.push(wb);
    const entries = await db.query('worldbookEntries', 'worldbookId', rel.worldbookId);
    worldbookEntries.push(...entries);
  }
  return {
    _meta: { app: 'phone-app', kind: 'session-export', version: 1, exportedAt: Date.now() },
    session,
    chatMessages,
    memories,
    character,
    persona,
    worldbooks,
    worldbookEntries,
    characterWorldbooks: cwbRels,
  };
}

// Insert payload as a new session — keeps original IDs for character /
// worldbook / persona / link rows (skip if already present locally), but
// generates a fresh sessionId and fresh message/memory IDs so re-importing
// the same file twice produces two independent sessions. reply.quoteMsgId
// is remapped through the new IDs to keep quote bubbles pointing at the
// right messages.
async function importSessionFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?._meta?.kind !== 'session-export') {
    throw new Error('文件不是 session 导出格式');
  }

  if (data.character) {
    const existing = await db.get('characters', data.character.id);
    if (!existing) await db.set('characters', data.character);
  }
  if (data.persona) {
    const existing = await db.get('personas', data.persona.id);
    if (!existing) await db.set('personas', data.persona);
  }
  for (const wb of data.worldbooks || []) {
    if (!(await db.get('worldbooks', wb.id))) await db.set('worldbooks', wb);
  }
  for (const we of data.worldbookEntries || []) {
    if (!(await db.get('worldbookEntries', we.id))) await db.set('worldbookEntries', we);
  }
  for (const cwb of data.characterWorldbooks || []) {
    if (!(await db.get('characterWorldbooks', cwb.id))) await db.set('characterWorldbooks', cwb);
  }

  const newSid = db.newId();
  const baseTs = Date.now();
  await db.set('chatSessions', {
    ...data.session,
    id: newSid,
    createdAt: baseTs,
    lastMessageAt: baseTs,
  });

  const msgIdMap = new Map();
  for (const m of data.chatMessages || []) msgIdMap.set(m.id, db.newId());
  for (const m of data.chatMessages || []) {
    const remappedActions = (m.actions || []).map(a => {
      if (a.type === 'reply' && a.quoteMsgId && msgIdMap.has(a.quoteMsgId)) {
        return { ...a, quoteMsgId: msgIdMap.get(a.quoteMsgId) };
      }
      return a;
    });
    await db.set('chatMessages', {
      ...m,
      id: msgIdMap.get(m.id),
      sessionId: newSid,
      actions: remappedActions,
    });
  }

  for (const mem of data.memories || []) {
    await db.set('memories', {
      ...mem,
      id: db.newId(),
      sessionId: newSid,
    });
  }

  return newSid;
}
