// Page navigation and stack management.
// Each page is identified by a string id and mapped to a mountFn:
//   async mountFn(container, params, routerApi) => teardownFn
// navigate clears container, calls previous teardown, then mounts new page.

const pages = new Map();
const stack = [];
let _container = null;
let _teardown = null;

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
