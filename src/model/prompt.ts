import type { SessionMessageUser } from "@opencode/client/promise";

import { jsonText } from "./activity";

interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The typed prompt with the native mention spans removed when they still match. */
export function promptText(message: SessionMessageUser): string | undefined {
  const displayText = jsonText(message.metadata?.displayText);
  let text = displayText !== undefined && displayText.trim() !== "" ? displayText : message.text;
  const mentions: MentionRange[] = [];
  for (const attachment of [
    ...(message.files ?? []),
    ...(message.agents ?? []),
    ...(message.skills ?? []),
  ]) {
    if (attachment.mention !== undefined) mentions.push(attachment.mention);
  }
  // Earlier offsets stay valid while later ranges are removed first.
  for (const mention of mentions.toSorted((a, b) => b.start - a.start)) {
    const { start, end } = mention;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end > text.length || start >= end) continue;
    if (text.slice(start, end) !== mention.text) continue;
    text = `${text.slice(0, start)}${text.slice(end)}`;
  }
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}
