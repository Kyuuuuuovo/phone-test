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
  _teardown = await mount(_container, params, { navigate, back });
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
