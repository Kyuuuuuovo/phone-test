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

// In-page notification dialog — replaces window.alert() so info / error
// messages stay inside the phone-frame and pick up theme styling. Single
// button, resolves on click / Enter / Escape. Returns Promise<void>.
//
// danger:true tints the title strip red — useful for error messages.
export function openAlert(container, { title = '提示', message, label = '好', danger = false }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop confirm-modal-backdrop';
    modal.innerHTML = `
      <div class="modal confirm-modal${danger ? ' alert-danger' : ''}">
        <div class="modal-header">${escHtml(title)}</div>
        <div class="confirm-message">${escHtml(message)}</div>
        <div class="modal-actions">
          <button type="button" class="btn confirm-btn">${escHtml(label)}</button>
        </div>
      </div>
    `;
    container.appendChild(modal);
    const cleanup = () => { modal.remove(); document.removeEventListener('keydown', onKey); resolve(); };
    modal.querySelector('.confirm-btn').addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
    const confirmBtn = modal.querySelector('.confirm-btn');
    setTimeout(() => confirmBtn.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); cleanup(); }
    };
    document.addEventListener('keydown', onKey);
  });
}

// In-page confirm dialog — replaces window.confirm() so the prompt stays
// inside the phone-frame and picks up theme styling. Returns Promise<boolean>:
//   true  = user clicked confirm
//   false = user clicked cancel OR clicked the backdrop OR pressed Escape
//
// Args:
//   title         — header (string)
//   message       — body line(s) (string; \n preserved via white-space: pre-wrap)
//   confirmLabel  — text on the affirmative button (default '确认')
//   cancelLabel   — text on the dismissive button (default '取消')
//   danger        — when true, the confirm button is styled red (delete-action)
export function openConfirm(container, { title, message, confirmLabel = '确认', cancelLabel = '取消', danger = false }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop confirm-modal-backdrop';
    modal.innerHTML = `
      <div class="modal confirm-modal">
        <div class="modal-header">${escHtml(title)}</div>
        <div class="confirm-message">${escHtml(message)}</div>
        <div class="modal-actions">
          <button type="button" class="btn secondary cancel-btn">${escHtml(cancelLabel)}</button>
          <button type="button" class="btn${danger ? ' danger' : ''} confirm-btn">${escHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    container.appendChild(modal);

    const cleanup = () => modal.remove();
    const cancel  = () => { cleanup(); resolve(false); };
    const accept  = () => { cleanup(); resolve(true); };

    modal.querySelector('.cancel-btn').addEventListener('click', cancel);
    modal.querySelector('.confirm-btn').addEventListener('click', accept);
    modal.addEventListener('click', (e) => { if (e.target === modal) cancel(); });
    // Auto-focus the confirm button so Enter accepts. Escape cancels.
    const confirmBtn = modal.querySelector('.confirm-btn');
    setTimeout(() => confirmBtn.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape')      { e.preventDefault(); cancel(); document.removeEventListener('keydown', onKey); }
      else if (e.key === 'Enter')  { e.preventDefault(); accept(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
}
function escAttr(s) { return escHtml(s); }
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }
