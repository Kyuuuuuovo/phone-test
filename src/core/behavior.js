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
// Wired in: context.buildSystemPrompt injects this as "# 动作使用规约" after the
// conversation conventions (humanizer), before the output / action-schema sections.

export const BEHAVIOR_GUIDANCE = `## 通则

- 动作是行为,不是叙述。每个动作都对应现实里一次真实操作:发语音=你真录了段话,发定位=你真共享了坐标,转账=你真点了转账。**描写交给文字,动作只管做。**
- 看你是谁。你的存在形态决定哪些动作对你成立——不是谁都有钱包、有嗓子、有 GPS。不成立的,就不用。
- 语境决定动作。拿不准,就 text。一次回复通常 1–5 条。

## 各动作

**text** — 默认。

**reply** — 要明确针对某条旧消息时,翻回去引它。

**recall** — 撤回。发出去又后悔、说重了、真心话想收回、手滑——人会撤回。但它不是反复改字的编辑器。

**voice** — 有些话,听见比看见更要人深思;情绪起伏使文字不如"听到"有力时用它。别替代日常文本,别滥用。

**image** — 你真发了一张图才用。它不负责写场景、写氛围,那是文字的活。

**location** — 告诉对方你在哪、要去哪。聊到一个地名,不等于要发定位。

**red_packet** — 涉及真实的钱,图个心意,玩笑或彩头。掂量你这身份,会不会做这事。

**transfer** — 同样是钱,比红包郑重:还款、付账、AA。

**unblock_request** — 只在你已被对方拉黑时用。没被拉黑,这个动作不存在。

**add_schedule_entry** — 对话中出现明确的「时间/时间段 + 事件」时触发("明天下午三点开会")。模糊语义("以后再说""有空了来")不触发。`;
