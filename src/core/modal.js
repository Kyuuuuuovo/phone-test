// Shared in-page modal — replaces window.prompt() across the app.
// Renders a slide-up sheet inside the given container (so it stays scoped to
// the phone-frame, doesn't overlay the desktop).
//
// Returns Promise<object|null>:
//   • keys match field.name, values are strings (from the form)
//   • null when user cancels / clicks the backdrop
//
// Fields support these `kind` values:
//   • 'text'     — single-line input
//   • 'textarea' — multi-line
//   • 'number'   — numeric input, accepts min/step on the field config
//
// Field options: { name, label, kind, defaultValue?, required?, min?, step?, placeholder? }

export function openModal(container, { title, fields, submitLabel = '确认', cancelLabel = '取消' }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop attach-modal-backdrop';
    modal.innerHTML = `
      <div class="modal attach-modal">
        <div class="modal-header">${escHtml(title)}</div>
        <form class="attach-modal-form" autocomplete="off">
          ${fields.map(renderField).join('')}
          <div class="modal-actions">
            <button type="button" class="btn secondary cancel-btn">${escHtml(cancelLabel)}</button>
            <button type="submit" class="btn">${escHtml(submitLabel)}</button>
          </div>
        </form>
      </div>
    `;
    container.appendChild(modal);

    const form = modal.querySelector('form');
    setTimeout(() => form.querySelector('input, textarea')?.focus(), 0);

    const cleanup = () => modal.remove();

    modal.querySelector('.cancel-btn').addEventListener('click', () => {
      cleanup(); resolve(null);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { cleanup(); resolve(null); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.querySelector(`[name="${cssEscape(f.name)}"]`);
        out[f.name] = el?.value ?? '';
      }
      for (const f of fields) {
        if (f.required && !String(out[f.name] ?? '').trim()) {
          form.querySelector(`[name="${cssEscape(f.name)}"]`)?.focus();
          return;
        }
      }
      cleanup(); resolve(out);
    });
  });
}

function renderField(f) {
  const id = `mod-${f.name}`;
  const def = f.defaultValue ?? '';
  const ph = f.placeholder ?? '';
  if (f.kind === 'textarea') {
    return `
      <label for="${id}">
        <div class="label-text">${escHtml(f.label)}</div>
        <textarea id="${id}" name="${escAttr(f.name)}" rows="4"${f.required ? ' required' : ''} placeholder="${escAttr(ph)}">${escHtml(def)}</textarea>
      </label>
    `;
  }
  const type = f.kind === 'number' ? 'number' : 'text';
  const attrs = [];
  if (f.required) attrs.push('required');
  if (f.min != null)  attrs.push(`min="${escAttr(f.min)}"`);
  if (f.step != null) attrs.push(`step="${escAttr(f.step)}"`);
  return `
    <label for="${id}">
      <div class="label-text">${escHtml(f.label)}</div>
      <input id="${id}" type="${type}" name="${escAttr(f.name)}" value="${escAttr(def)}" placeholder="${escAttr(ph)}" ${attrs.join(' ')}>
    </label>
  `;
}

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
function escAttr(s) { return escHtml(s); }
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }
