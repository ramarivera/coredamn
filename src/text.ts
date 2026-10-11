import type { Content } from "./schemas.ts";

export function contentText(content: Content | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((block) => block.type === "text" || block.type === "input_text")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function humanText(text: string, codex = false): string {
  let result = text;
  if (codex) {
    const marker = "## My request for Codex:";
    if (result.includes(marker)) result = result.slice(result.indexOf(marker) + marker.length);
    else if (
      /^\s*(?:# AGENTS\.md|<INSTRUCTIONS>|<environment_context>|<permissions instructions>|<user_instructions>)/u.test(
        result,
      )
    )
      return "";
  }
  // Structured context wrappers aren't human prose, even when serialized with a
  // user role. Don't strip ordinary quotes or assume swearing is directed abuse.
  result = result.replace(
    /<(environment_context|system-reminder|system_reminder|INSTRUCTIONS|user_instructions|permissions instructions|local-command-stdout|local-command-stderr)\b[^>]*>[\s\S]*?<\/\1>/gu,
    " ",
  );
  return result.trim();
}

export function prose(text: string): string {
  // An unclosed fenced block consumes the remaining text. Inline code and URLs
  // also leave the numerator and denominator together.
  return text
    .normalize("NFKC")
    .replace(/(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[ \t]*(?=\n|$)|$)/gu, " ")
    .replace(/(`+)[^`]*?\1/gu, " ")
    .replace(/https?:\/\/\S+/gu, " ");
}

const segmenter = new Intl.Segmenter("en", { granularity: "word" });
export function wordCount(text: string): number {
  let words = 0;
  for (const part of segmenter.segment(text)) if (part.isWordLike) words++;
  return words;
}
