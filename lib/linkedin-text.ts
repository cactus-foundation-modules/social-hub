// LinkedIn reads a post's text as "little text format": ( ) [ ] { } < > @ | _ * ~ \
// mean mentions, templates and styling, and an unescaped one quietly truncates
// the post at that point. They all have to be backslash-escaped. A # is left
// alone when it starts a hashtag (so #cactus stays a link) and escaped otherwise.

const ALWAYS_ESCAPED = /[\\|{}@[\]()<>*_~]/g

export function escapeLinkedInText(text: string): string {
  const escaped = text.replace(ALWAYS_ESCAPED, (c) => `\\${c}`)
  return escaped.replace(/#(?![A-Za-z0-9_\\])/g, '\\#')
}
