import * as db from './db.js';

// 通用表单 dirty 状态 helper — 监听 form 的 input/change,在 saveBtn 上切
// 「保存 / 已保存」两种视觉状态。业务页保存完手动调 markSaved(),helper 自
// 动监听后续修改翻回 dirty。
//
// 用法:
//   const dirty = bindFormDirty(form, saveBtn);
//   dirty.markSaved();  // 进页面 / 保存成功后
//
// 设计选择:
//   - saveBtn 不设 disabled — saved 状态下用户仍能点(等同 no-op 提交),
//     不阻挡 form submit。只是视觉变灰让用户看清"这一轮已经保存了,不用
//     再点"。
//   - 不在内部 attach submit handler — 业务代码各自的 onSubmit 在保存成功
//     后调 markSaved() 即可,让 helper 跟业务保存流程解耦(有些页面有「保存」
//     按钮 + 别的按钮也写 IDB 比如「测试连接」会顺手保存)。
//   - 初始状态默认 dirty(没 markSaved 之前都视作 dirty)— 进页面之后,业务
//     代码先调 markSaved() 翻成 saved 即可。这是为了避免 helper 误判:有些
//     页面读 IDB 后还要做字段 normalize 才显示给 user,期间表单值可能跟存
//     储不一致。

export function bindFormDirty(form, saveBtn, opts = {}) {
  const { savedLabel = '已保存' } = opts;
  // 拿原 label 当 dirty 文案(通常是「保存」)。多次 bind 同一个 btn 时
  // dataset.dirtyLabel 保住第一次的原值,避免被 「已保存」 污染。
  const dirtyLabel = saveBtn.dataset.dirtyLabel
    || saveBtn.textContent.trim()
    || '保存';
  saveBtn.dataset.dirtyLabel = dirtyLabel;

  function markDirty() {
    if (!saveBtn.classList.contains('saved')) return;
    saveBtn.classList.remove('saved');
    saveBtn.textContent = dirtyLabel;
  }
  function markSaved() {
    saveBtn.classList.add('saved');
    saveBtn.textContent = savedLabel;
  }

  // input event 覆盖 text/textarea/checkbox/radio/range/number...
  // change event 兜 select 和 file (有些浏览器 input 不触发 select)。
  form.addEventListener('input',  markDirty);
  form.addEventListener('change', markDirty);

  return { markDirty, markSaved };
}

// 「草稿回收」(Option A):「+ 新建」会先建一条空记录再进编辑页 —— 因为详情页那些
// 边改边存的子功能(世界书条目 / 角色挂载世界书 / 拉黑)需要记录已存在。代价是没按
// 保存就已落库。这里给「没动过就离开 → 回收空白草稿」兜底:
//   - isNew 由列表页 navigate('xxx-detail', { id, isNew: true }) 传入。
//   - 任意编辑动作里调 touch();bindTouch(el) 给 form/容器挂 input+change 自动 touch。
//   - 返回前 **await discardIfUntouched() 再 router.back()** —— router teardown 是
//     同步调的(不 await),只靠它会跟列表重渲染抢跑、空白闪一下。teardown 里再
//     fire-and-forget 兜一次,覆盖非返回键的退出路径。
export function newDraftGuard({ isNew, store, id }) {
  let touched = false, done = false;
  const touch = () => { touched = true; };
  async function discardIfUntouched() {
    if (done || !isNew || touched) return;
    done = true;
    try { await db.del(store, id); } catch { /* 已删 / 不存在都无所谓 */ }
  }
  function bindTouch(el) {
    el.addEventListener('input', touch);
    el.addEventListener('change', touch);
    return () => {
      el.removeEventListener('input', touch);
      el.removeEventListener('change', touch);
    };
  }
  return { touch, discardIfUntouched, bindTouch };
}
