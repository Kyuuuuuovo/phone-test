// 动作使用规约 — app-level rules about WHEN to use which action.
// Pairs with the action schemas in OUTPUT (which describe HOW to write them).
//
// AUTHOR-LOCKED: end users do not see or edit this. Edit BEHAVIOR_GUIDANCE
// below. Empty string = no injection.
//
// Boundary discipline (CLAUDE.md 铁律 3 + 10):
//   ✅ Action-context spec — "transfer 适用于钱款往来语境;用户提到欠款 / AA / 付钱
//      时是常见触发点。前端渲染成红包卡片,等用户确认。"
//   ❌ Character-behavior steering — "你应该在角色心软时主动转账让用户开心" —
//      that is exactly what 铁律 3 forbids. Keep this file action-centric and
//      neutral; per-character behavior belongs in character.persona.
//
// Wired in: context.buildSystemPrompt injects this as "# 动作使用规约" between
// the conversation conventions (humanizer) and the per-turn featureContext.

export const BEHAVIOR_GUIDANCE = ``;
