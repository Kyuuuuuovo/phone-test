// Global conversation conventions — app-level meta constraint.
// This file is part of the app: the END USER cannot see or edit it.
// It is YOUR (author's) lever for shaping conversation tone, format,
// "no AI-flavor" rules, message cadence, etc. across every prompt the app sends.
//
// Edit HUMANIZER_PROMPT below. Empty string = no injection.
// Wired in: context.buildSystemPrompt prepends this as the first section,
// before # 角色设定. Future scenarios (朋友圈 / 日记 / 论坛 …) should import
// from here too — one source of truth.
//
// See CLAUDE.md 铁律 10 for why this is allowed even though 铁律 3 forbids
// per-character behavior steering.

// Five-section skeleton — author fills the body of each. Sections can be renamed,
// merged, or deleted as you see fit; nothing in code depends on these headings.
export const HUMANIZER_PROMPT = `
## 1. 反 AI 腔(禁词清单 / 错误·正确对照)

## 2. 碎片化节奏(连续短消息)

## 3. 人设驱动的语气分叉

## 4. 情绪直给 + 记忆联想

## 5. 格式清洗(禁止系统标签复读 / 旁白括号)
`;
