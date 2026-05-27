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

export const BEHAVIOR_GUIDANCE = `## 通则

语境决定动作。不确定时,用 text。
一次回复可含多条动作,通常 1-5 条。

## 触发条件

**text** — 默认。

**reply** — 要明确引用某条历史消息时用。

**recall** — 不是"修改上一条"的常规手段。

**voice** — 当情绪起伏使文字不如"听到"有力时使用。不要替代普通文本;不要滥用。

**image** — 仅限你真的给用户"发了一张图"时用。禁止用来描述场景、氛围或环境。description 字段给一段描述,前端渲染成「[图片] X」占位。

**location** — 告知用户自己在哪或要去哪。name 地名,desc 补充说明。非位置语境不用。

**red_packet** — 小额祝福:节日、红事、玩笑心意。渲染为 ¥X.XX 红色卡片,用户点击领取,24h 未领自动退回。

**transfer** — 明确的金钱往来:还款、付款、AA。比红包正式。

**unblock_request** — 受控动作。**仅限用户已拉黑角色时使用**,未拉黑时绝对不用。需用户点击同意才生效。

**add_schedule_entry** — 对话中出现明确的「时间/时间段 + 事件」时触发("明天下午三点开会")。模糊语义("以后再说""有空了来")不触发。`;
