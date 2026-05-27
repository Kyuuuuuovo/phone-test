// Messaging shell. WeChat-style 3-tab container: 消息 / 通讯录 / 朋友圈.
// Hosts the embedded chat-list under "消息", a contacts list under "通讯录",
// and a moments placeholder under "朋友圈". Header title + primary action
// follow the active tab.

import { mountChatList, openNewChatModal } from '../chat-list/chat-list.js';
import { mountContacts } from './contacts.js';
import { mountMoments }  from './moments.js';
import { mountMe }       from './me.js';

const TABS = [
  { id: 'chats',    label: '消息',   title: '微信',   icon: SVG('chat') },
  { id: 'contacts', label: '通讯录', title: '通讯录', icon: SVG('contacts') },
  { id: 'moments',  label: '朋友圈', title: '朋友圈', icon: SVG('moments') },
  { id: 'me',       label: '我',     title: '我',     icon: SVG('me') },
];

export async function mountMessaging(container, params, router) {
  const initialTab = TABS.some(t => t.id === params?.tab) ? params.tab : 'chats';

  container.innerHTML = `
    <div class="page messaging-page">
      <header class="page-header">
        <button class="back">‹ 返回</button>
        <div class="title">${TABS.find(t => t.id === initialTab).title}</div>
        <div class="actions">
          <button class="new-chat" title="新建对话" hidden>+</button>
        </div>
      </header>
      <div class="messaging-content"></div>
      <nav class="messaging-tabs">
        ${TABS.map(t => `
          <button class="messaging-tab${t.id === initialTab ? ' active' : ''}" data-tab="${t.id}">
            <div class="tab-icon">${t.icon}</div>
            <div class="tab-label">${t.label}</div>
          </button>
        `).join('')}
      </nav>
    </div>
  `;

  const content   = container.querySelector('.messaging-content');
  const titleEl   = container.querySelector('.title');
  const tabsBar   = container.querySelector('.messaging-tabs');
  const backBtn   = container.querySelector('.back');
  const newBtn    = container.querySelector('.new-chat');
  let subTeardown = null;
  let activeTab   = null;

  async function selectTab(tabId) {
    if (tabId === activeTab) return;
    const tab = TABS.find(t => t.id === tabId) || TABS[0];
    activeTab = tab.id;
    titleEl.textContent = tab.title;

    // Tab indicator
    tabsBar.querySelectorAll('.messaging-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab.id);
    });

    // Header primary action — chats / contacts both use openNewChatModal.
    // Moments + Me tabs have no primary action,加号隐藏(否则 user 误以为
    // 这俩 tab 也能"新建什么")。
    newBtn.hidden = tab.id === 'moments' || tab.id === 'me';
    newBtn.title = tab.id === 'contacts' ? '添加联系人(从已有角色里选)' : '新建对话';

    // Teardown previous subview, mount new
    if (subTeardown) {
      try { subTeardown(); } catch (e) { console.warn('messaging: subview teardown threw', e); }
      subTeardown = null;
    }
    content.innerHTML = '';
    if (tab.id === 'chats')         subTeardown = await mountChatList(content, { embedded: true }, router);
    else if (tab.id === 'contacts') subTeardown = await mountContacts(content, {}, router);
    else if (tab.id === 'moments')  subTeardown = await mountMoments(content, {}, router);
    else if (tab.id === 'me')       subTeardown = await mountMe(content, {}, router);
  }

  const onTabClick = (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  };
  const onBack    = () => router.back();
  const onNewChat = () => openNewChatModal(container, router);

  tabsBar.addEventListener('click', onTabClick);
  backBtn.addEventListener('click', onBack);
  newBtn.addEventListener('click', onNewChat);

  await selectTab(initialTab);

  return () => {
    tabsBar.removeEventListener('click', onTabClick);
    backBtn.removeEventListener('click', onBack);
    newBtn.removeEventListener('click', onNewChat);
    if (subTeardown) { try { subTeardown(); } catch (_) {} }
  };
}

function SVG(kind) {
  switch (kind) {
    case 'chat':     return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
    case 'contacts': return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
    case 'moments':  return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/></svg>`;
    case 'me':       return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4.5-6 8-6s7 2 8 6"/></svg>`;
  }
  return '';
}
