// Page navigation and stack management.
// Each page is identified by a string id and mapped to a mountFn:
//   async mountFn(container, params, routerApi) => teardownFn
// navigate clears container, calls previous teardown, then mounts new page.

const pages = new Map();
const stack = [];
let _container = null;
let _teardown = null;

// 栈深度上限 — back() 净减 1 不会无限涨,但同一会话里持续 navigate 不 back
// 的极端情况(比如 50 个不同 app 跳来跳去)会让 stack 越来越大,内存压力不
// 大但调试时不好看。简单截顶保护。
const STACK_CAP = 50;

export function setContainer(el) {
  _container = el;
}

export function registerPage(id, mountFn) {
  pages.set(id, mountFn);
}

export async function navigate(id, params = {}) {
  const mount = pages.get(id);
  if (!mount) throw new Error(`router: unknown page "${id}"`);
  if (_teardown) {
    try { _teardown(); } catch (e) { console.warn('router: teardown threw', e); }
    _teardown = null;
  }
  if (_container) _container.innerHTML = '';
  stack.push({ id, params });
  // 超过 cap 砍头(丢最早的几条),保留最近的导航路径。
  if (stack.length > STACK_CAP) stack.splice(0, stack.length - STACK_CAP);
  // 让 CSS 知道当前 page —— 比如 .phone-frame::before 在非 home 时铺一层
  // var(--bg) 盖住壁纸,这样状态栏背景透明也不会透出壁纸到 app 里。
  document.body.dataset.route = id;
  // 全局错误边界:任何页面 mount 抛异常,都不该让 #page-container 白屏。兜底渲染
  // 一个错误页(可返回上一页重试),并 console.error 方便排查。
  try {
    _teardown = await mount(_container, params, { navigate, back });
  } catch (e) {
    console.error(`router: mount "${id}" threw`, e);
    _teardown = null;
    if (_container) {
      _container.innerHTML = `<div class="page"><header class="page-header"><button class="err-back">‹ 返回</button><div class="title">出错了</div></header><div class="page-body"><p>这个页面加载时出错了,可以返回上一页重试。</p><pre style="white-space:pre-wrap;font-size:11px;color:var(--muted,#999);margin-top:12px;overflow-wrap:anywhere">${escForRouter(e)}</pre></div></div>`;
      const b = _container.querySelector('.err-back');
      if (b) b.addEventListener('click', () => back());
    }
  }
}

// 错误页展示异常信息前转义,防错误文本里带 < > & 破坏 DOM。
function escForRouter(e) {
  return String((e && e.message) || e || '未知错误')
    .replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .slice(0, 300);
}

export async function back() {
  if (stack.length < 2) return;
  stack.pop();                  // drop current
  const prev = stack.pop();     // re-navigate to previous (re-pushes)
  await navigate(prev.id, prev.params);
}

export function current() {
  return stack[stack.length - 1] ?? null;
}
