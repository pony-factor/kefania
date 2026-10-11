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

test('draft-only performs no write and returns an unadorned description', async () => {
  const result = await runLocalPullRequest({ repository: 'owner/repo', head: 'branch', draftOnly: true }, {
    actions: { async context() { return { aheadBy: 1, headSha: 'verified' }; }, async create() { assert.fail('Must not publish'); } },
    async draft() { return { title: '🛠️ Fix PR drafting', body: 'Explain the change.' }; },
  });
  assert.equal(result.published, false);
  assert.equal(result.body, 'Explain the change.');
});

test('empty comparison and invalid model output cannot publish', async () => {
  const actions = { async context() { return { aheadBy: 0 }; }, async create() { assert.fail('Must not publish'); } };
  await assert.rejects(runLocalPullRequest({ repository: 'owner/repo', head: 'branch' }, { actions }), /committed changes/);
  actions.context = async () => ({ aheadBy: 1, headSha: 'verified' });
  await assert.rejects(runLocalPullRequest({ repository: 'owner/repo', head: 'branch' }, { actions, draft: async () => ({ title: 'Only title' }) }));
});

test('browser context and prepared drafts never invoke Codex and preserve the verified head', async () => {
  const sha = 'a'.repeat(40);
  let writes = 0;
  const actions = { async context() { return { aheadBy: 1, headSha: sha, files: [] }; },
    async create(input) { writes++; assert.equal(input.expectedHeadSha, sha); return { published: true }; } };
  const dependencies = { actions, draft() { assert.fail('Browser drafting must not consume a Codex run'); } };
  const input = { repository: 'owner/repo', head: 'branch' };
  assert.equal((await runLocalPullRequest({ ...input, contextOnly: true }, dependencies)).headSha, sha);
  assert.equal(writes, 0);
  const preparedDraft = { title: '🔧 Improve setup', body: 'Explain the change with a verified source.' };
  await runLocalPullRequest({ ...input, preparedDraft, expectedHeadSha: sha }, dependencies);
  assert.equal(writes, 1);
  await assert.rejects(runLocalPullRequest({ ...input, preparedDraft }, dependencies), /verified head SHA/);
  await assert.rejects(runLocalPullRequest({ ...input, preparedDraft, expectedHeadSha: 'b'.repeat(40) }, dependencies), /head changed/);
  assert.equal(writes, 1);
});
