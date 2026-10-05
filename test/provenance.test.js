import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatConversationSourceComment,
  plainSummary,
  sourceMarker
} from '../src/provenance.js';

const source = {
  kind: 'codex',
  uuid: '019c56c3-06fc-7db3-a928-9c3607e17129',
  url: 'https://vscode.dev/redirect?url=vscode%3A%2F%2Fexample',
  intentSummary: 'Keep the original goal\n  distinct from the final diff.'
};

test('formats one stable linked provenance block', () => {
  const comment = formatConversationSourceComment(source);
  assert.equal(
    comment,
    '<!-- kefania-conversation-source:codex:019c56c3-06fc-7db3-a928-9c3607e17129 -->\n'
      + '### Conversation source\n'
      + '[Codex conversation `019c56c3-06fc-7db3-a928-9c3607e17129`](https://vscode.dev/redirect?url=vscode%3A%2F%2Fexample)\n\n'
      + '**Intent:** Keep the original goal distinct from the final diff.'
  );
});

test('uses the UUID marker for deduplication', () => {
  assert.equal(
    sourceMarker({ kind: 'chatgpt', uuid: '11111111-2222-4333-8444-555555555555' }),
    '<!-- kefania-conversation-source:chatgpt:11111111-2222-4333-8444-555555555555 -->'
  );
});

test('keeps intent summaries brief on one line without rewriting words', () => {
  assert.equal(plainSummary('  one\n\ttwo   three  '), 'one two three');
});
