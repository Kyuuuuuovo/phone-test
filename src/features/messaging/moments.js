// 朋友圈 placeholder. Scaffold for Phase 3 feature — currently shows an empty
// state explaining the feature isn't built yet so users don't think it's broken.

export async function mountMoments(container, params, router) {
  container.innerHTML = `
    <div class="moments-body">
      <div class="moments-cover"></div>
      <div class="empty-state moments-empty">
        朋友圈还没做<br>
        会跟 角色 / 世界书 联动,允许 AI 发动态、点赞、评论。<br>
        敬请期待。
      </div>
    </div>
  `;
  return () => {};
}
