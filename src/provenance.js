const SOURCE_MARKER_PREFIX = 'kefania-conversation-source';

function plainSummary(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourceMarker(source) {
  return `<!-- ${SOURCE_MARKER_PREFIX}:${source.kind}:${source.uuid} -->`;
}

function formatConversationSourceComment(source) {
  const kind = source.kind === 'codex' ? 'Codex conversation' : 'ChatGPT conversation';
  const summary = plainSummary(source.intentSummary);
  const lines = [
    sourceMarker(source),
    '### Conversation source',
    `[${kind} \`${source.uuid}\`](${source.url})`,
  ];
  if (summary) {
    lines.push('', `**Intent:** ${summary}`);
  }
  return lines.join('\n');
}

export { SOURCE_MARKER_PREFIX, formatConversationSourceComment, plainSummary, sourceMarker };
