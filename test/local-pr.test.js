import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalPullRequest } from '../src/local-pr.js';

test('local drafter passes the verified head and generated text to the gh publisher', async () => {
  const source = { kind: 'chatgpt', uuid: '11111111-2222-4333-8444-555555555555', url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555' };
  let published;
  const result = await runLocalPullRequest({ repository: 'owner/repo', head: 'branch', source }, {
    actions: {
      async context(selection) { assert.equal(selection.base, 'main'); return { aheadBy: 1, headSha: 'verified', files: [] }; },
      async create(args) { published = args; return { url: 'https://github.com/owner/repo/pull/1' }; },
    },
    async draft(prompt) { assert.match(prompt, /Do not publish anything or use tools/); return { title: '🛠️ Fix PR drafting', body: 'Explain the change.' }; },
  });
  assert.equal(published.expectedHeadSha, 'verified');
  assert.equal(published.title, '🛠️ Fix PR drafting');
  assert.deepEqual(published.source, source);
  assert.equal(published.draft, false);
  assert.equal(result.url, 'https://github.com/owner/repo/pull/1');
});

test('draft-only performs no write and includes the footer', async () => {
  const result = await runLocalPullRequest({ repository: 'owner/repo', head: 'branch', draftOnly: true }, {
    actions: { async context() { return { aheadBy: 1, headSha: 'verified' }; }, async create() { assert.fail('Must not publish'); } },
    async draft() { return { title: '🛠️ Fix PR drafting', body: 'Explain the change.' }; },
  });
  assert.equal(result.published, false);
  assert.match(result.body, /This PR description was written automatically/);
});

test('empty comparison and invalid model output cannot publish', async () => {
  const actions = { async context() { return { aheadBy: 0 }; }, async create() { assert.fail('Must not publish'); } };
  await assert.rejects(runLocalPullRequest({ repository: 'owner/repo', head: 'branch' }, { actions }), /committed changes/);
  actions.context = async () => ({ aheadBy: 1, headSha: 'verified' });
  await assert.rejects(runLocalPullRequest({ repository: 'owner/repo', head: 'branch' }, { actions, draft: async () => ({ title: 'Only title' }) }));
});
