// Page navigation and stack management.
// Each page is a string id mapped to a mount function. Stack supports back().

const pages = new Map();    // id -> mountFn(container, params)
const stack = [];           // [{ id, params }, ...]

export function registerPage(id, mountFn) {
  pages.set(id, mountFn);
}

export async function navigate(pageId, params = {}) {
  throw new Error('router.navigate: not implemented');
}

export async function back() {
  throw new Error('router.back: not implemented');
}

export function current() {
  return stack[stack.length - 1] ?? null;
}
