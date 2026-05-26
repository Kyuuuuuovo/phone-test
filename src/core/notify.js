// Browser Notification API wrapper for "AI 回复完成时弹系统通知".
//
// What this does and doesn't:
//   - DOES alert the user via the OS notification center if they've
//     navigated away from the tab (document.hidden===true) when the AI
//     reply lands. Works for backgrounded browser tabs in most modern
//     desktop browsers, and via the device's notification bell on some
//     mobile browsers.
//   - DOES NOT work after the tab is closed or the browser is killed —
//     that requires a service worker + push server + backend, which
//     CLAUDE.md 铁律 1 rules out.
//
// Permission UX (browsers throttle prompts hard, so don't auto-ask):
//   - Don't prompt at boot. Users get a permission popup with no context.
//   - Prompt on the settings toggle's flip-to-on. requestPermission()
//     can only be called from a user gesture in some browsers, so a
//     click handler is the right place.
//   - If the user denies, browser policy usually blocks re-asking.
//     We surface that via the toggle staying off + a hint.
//
// Settings:
//   settings.notifyOnReply — boolean, default false (opt-in). Even when
//     true, fires only if Notification.permission === 'granted' AND
//     document.hidden. So a stale "true" with revoked permission is just
//     a no-op, not an error.

import * as db from './db.js';

let routerRef = null;

export function init(router) {
  routerRef = router;
}

export function isSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permission() {
  if (!isSupported()) return 'unsupported';
  return Notification.permission;  // 'default' | 'granted' | 'denied'
}

export async function requestPermission() {
  if (!isSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    // Older Safari versions resolve via callback only; treat as failure.
    return Notification.permission;
  }
}

// Fire one for an AI reply. No-op if any precondition fails — silently
// returning lets the chat flow ignore this completely.
export async function notifyAIReply(sessionId, messageId) {
  if (!isSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;  // tab visible — no need to alert
  const settings = (await db.get('settings', 'default')) || {};
  if (settings.notifyOnReply !== true) return;

  const msg = messageId ? await db.get('chatMessages', messageId) : null;
  if (!msg) return;
  const session = await db.get('chatSessions', sessionId);
  const character = session ? await db.get('characters', session.characterId) : null;

  const title = `${character?.name || '角色'} 回复了你`;
  const body = previewOf(msg.actions || []) || '(新消息)';
  const opts = { body, tag: `chat-${sessionId}` };  // tag dedups stacked notifications per session
  if (character?.avatar) opts.icon = character.avatar;

  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      // Bring the tab to front + jump to that chat.
      try { window.focus(); } catch (_) {}
      try { routerRef?.navigate('chat', { sessionId }); } catch (_) {}
      n.close();
    };
  } catch (e) {
    // Some browsers throw if Notification is constructed too quickly
    // after page load. Non-critical — just swallow.
    console.warn('[notify] failed:', e);
  }
}

function previewOf(actions) {
  for (const a of actions) {
    if (a.type === 'text' || a.type === 'reply')   return (a.content || '').slice(0, 80);
    if (a.type === 'voice')                        return `[语音] ${(a.content || '').slice(0, 60)}`;
    if (a.type === 'image')                        return `[图片] ${(a.description || '').slice(0, 60)}`;
    if (a.type === 'red_packet')                   return `[红包 ¥${Number(a.amount || 0).toFixed(2)}]`;
    if (a.type === 'transfer')                     return `[转账 ¥${Number(a.amount || 0).toFixed(2)}]`;
    if (a.type === 'location')                     return `[位置: ${a.name || ''}]`;
  }
  return '';
}
