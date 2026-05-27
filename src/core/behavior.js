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

export const BEHAVIOR_GUIDANCE = `用户的消息有时末尾带 [心声:...] 标记,那是用户的真实情绪 / 真实想法 — 现实里说不出口、嘴上说着别的。
据此调整你对 ta 的态度和判断(ta 嘴上说"没事"但心声"其实很难过" — 你应该感知到 ta 在硬撑),但**不要直接复述心声内容**,也不要明说"你知道 ta 心里在想什么"。表现成"敏锐地察觉到了"而不是"读心术"。`;
