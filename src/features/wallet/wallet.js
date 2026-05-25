// Wallet page — virtual balance + transaction history aggregated across all
// chat sessions. Balance is maintained by chat.js (debited on user-sent
// red_packet/transfer, credited when user claims one sent by the AI). This
// page just renders + lets the user top up.

import * as db from '../../core/db.js';
import { openModal } from '../../core/modal.js';

export async function mountWallet(container, params, router) {
  async function render() {
    const wallet = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
    const txns = await collectTransactions();

    container.innerHTML = `
      <div class="page wallet-page">
        <header class="page-header">
          <button class="back">‹ 返回</button>
          <div class="title">钱包</div>
        </header>
        <div class="page-body">
          <div class="wallet-balance-card">
            <div class="wallet-balance-label">余额</div>
            <div class="wallet-balance-amount">¥${Number(wallet.balance || 0).toFixed(2)}</div>
            <div class="wallet-actions">
              <button type="button" class="btn topup-btn">充值</button>
              <button type="button" class="btn secondary withdraw-btn">提现</button>
            </div>
          </div>

          <h3 class="wallet-section-title">流水(${txns.length})</h3>
          ${txns.length === 0 ? `
            <p class="hint">还没有流水。在聊天里发红包/转账或领对方的红包就会出现。</p>
          ` : `
            <div class="wallet-txn-list">
              ${txns.map(t => `
                <div class="wallet-txn ${t.direction}">
                  <div class="txn-info">
                    <div class="txn-title">${esc(t.title)}</div>
                    <div class="txn-sub">${esc(t.sub)}</div>
                  </div>
                  <div class="txn-amount">${t.direction === 'in' ? '+' : '-'}¥${t.amount.toFixed(2)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    container.querySelector('.back').addEventListener('click', () => router.back());

    container.querySelector('.topup-btn').addEventListener('click', async () => {
      const v = await openModal(container, {
        title: '充值',
        fields: [{ name: 'amount', label: '金额 (¥)', kind: 'number', defaultValue: '100', required: true, min: 0.01, step: 0.01 }],
        submitLabel: '充值',
      });
      if (!v) return;
      const amount = parseFloat(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const w = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
      w.balance = Number((Number(w.balance || 0) + amount).toFixed(2));
      await db.set('wallet', w);
      await render();
    });

    container.querySelector('.withdraw-btn').addEventListener('click', async () => {
      const w = (await db.get('wallet', 'default')) || { id: 'default', balance: 0 };
      const v = await openModal(container, {
        title: `提现 · 余额 ¥${Number(w.balance || 0).toFixed(2)}`,
        fields: [{ name: 'amount', label: '金额 (¥)', kind: 'number', defaultValue: '', required: true, min: 0.01, step: 0.01 }],
        submitLabel: '确认提现',
      });
      if (!v) return;
      const amount = parseFloat(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (amount > Number(w.balance || 0)) { alert('余额不足'); return; }
      w.balance = Number((Number(w.balance || 0) - amount).toFixed(2));
      await db.set('wallet', w);
      await render();
    });
  }

  await render();
  return () => {};
}

// Walk every chat message looking for red_packet / transfer actions, project
// them as wallet transactions. Out = sent by user; in = sent by character and
// claimed by user. Unclaimed in-bound packets don't count yet.
async function collectTransactions() {
  const allMsgs = await db.getAll('chatMessages');
  const charsCache = new Map();
  async function charName(sessionId) {
    if (charsCache.has(sessionId)) return charsCache.get(sessionId);
    const s = await db.get('chatSessions', sessionId);
    const c = s ? await db.get('characters', s.characterId) : null;
    const name = c?.name || '(未知)';
    charsCache.set(sessionId, name);
    return name;
  }

  const out = [];
  for (const m of allMsgs) {
    const actions = m.actions || [];
    for (const a of actions) {
      if (a.type !== 'red_packet' && a.type !== 'transfer') continue;
      const kindLabel = a.type === 'red_packet' ? '红包' : '转账';
      const peer = await charName(m.sessionId);
      const amount = Number(a.amount || 0);
      if (m.role === 'user') {
        // User sent → outgoing
        out.push({
          ts: m.createdAt,
          direction: 'out',
          amount,
          title: `发出${kindLabel}`,
          sub: `给 ${peer} · ${a.message || '(无留言)'}`,
        });
      } else if (m.role === 'character' && a.claimed) {
        // Char sent + user claimed → incoming
        out.push({
          ts: a.claimedAt || m.createdAt,
          direction: 'in',
          amount,
          title: `收到${kindLabel}`,
          sub: `来自 ${peer} · ${a.message || '(无留言)'}`,
        });
      }
    }
  }
  out.sort((a, b) => b.ts - a.ts);  // newest first
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
