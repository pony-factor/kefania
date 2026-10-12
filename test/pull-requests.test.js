import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions, descriptionBody, FOOTER, initialPromptBody } from '../src/pull-requests.js';

const sha = 'a'.repeat(40);
const selection = { owner: 'pony-factor', repo: 'kefania', head: 'feature', base: 'main' };
const pr = { number: 42, html_url: 'https://github.com/pony-factor/kefania/pull/42', head: { ref: 'feature', label: 'pony-factor:feature' }, base: { ref: 'main' } };
const source = { kind: 'chatgpt', uuid: '11111111-2222-4333-8444-555555555555', url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555' };
function fixture({ existing = false, changed = false, noChanges = false, commentFailure = false,
  editFailure = false, existingBase = 'main', closed = false, historicalBase = 'b'.repeat(40),
  currentBase = 'b'.repeat(40) } = {}) {
  const calls = [], comments = [];
  const request = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint.includes('/compare/')) return { ahead_by: noChanges ? 0 : 1, total_commits: 1,
      base_commit: { sha: 'b'.repeat(40) }, merge_base_commit: { sha: currentBase }, commits: [{ sha }], files: [
      { filename: '.env', patch: 'PRIVATE_FIXTURE' },
      { filename: 'ordinary.txt', previous_filename: '.env.production', patch: 'PRIVATE_RENAME' },
      { filename: 'src/app.js', patch: '+fixed', additions: 1, deletions: 0, status: 'modified' },
    ] };
    if (endpoint.includes('/commits/')) return { sha: changed ? 'c'.repeat(40) : sha };
    if (endpoint.includes('/pulls?')) {
      const state = new URLSearchParams(endpoint.split('?')[1]).get('state');
      if (state === 'closed') return closed ? [{ ...pr, number: 41, state: 'closed' }] : [];
      return existing ? [{ ...pr, base: { ref: existingBase },
        head: { ...pr.head, repo: { full_name: selection.owner + '/' + selection.repo } } }] : [];
    }
    if (endpoint.endsWith('/pulls/41/commits?per_page=1')) return [{ parents: [{ sha: historicalBase }] }];
    if (options.method === 'POST' && endpoint.endsWith('/pulls')) { existing = true; return pr; }
    if (options.method === 'PATCH') {
      if (editFailure) throw new Error('edit failed');
      return pr;
    }
    if (options.method === 'POST' && endpoint.endsWith('/comments')) {
      if (commentFailure) throw new Error('comment failed');
      const comment = { ...options.body, html_url: pr.html_url + '#issuecomment-123' };
      comments.push(comment); return comment;
    }
    if (endpoint.includes('/comments?')) return comments;
    throw new Error('Unexpected API operation');
  };
  return { actions: createActions({ request }), calls };
}
const create = { ...selection, expectedHeadSha: sha, title: '🐛 Fix the button', body: 'Submit the drafting prompt.' };

test('context withholds secret contents and flags incomplete evidence', async () => {
  const { actions } = fixture();
  const context = await actions.context(selection);
  assert.equal(context.headSha, sha);
  assert.equal(context.newPullRequest.allowed, true);
  assert.equal(context.newPullRequest.startingBaseSha, 'b'.repeat(40));
  assert.equal(context.incomplete, true);
  assert(!JSON.stringify(context).includes('PRIVATE_FIXTURE'));
  assert(!JSON.stringify(context).includes('PRIVATE_RENAME'));
  assert.equal(context.files[2].patch, '+fixed');
});
test('creation omits automatic footer and defaults to ready for review', async () => {
  const { actions, calls } = fixture();
  const result = await actions.create({ ...create });
  assert.equal(result.url, pr.html_url);
  const published = calls.find(call => call.method === 'POST' && call.endpoint.endsWith('/pulls')).body;
  assert.equal(published.draft, false);
  assert.equal(published.body, create.body);
  assert.equal(FOOTER, '');
  assert.throws(() => descriptionBody('   '), /substantive/);
});
test('prompt edit history keeps exact original whitespace', async () => {
  const { actions, calls } = fixture();
  const prompt = '  typo\n\n exact   ';
  const result = await actions.create({ ...create, prompt });
  assert.equal(calls.find(call => call.method === 'POST').body.body, initialPromptBody(prompt));
  assert.equal(calls.find(call => call.method === 'PATCH').body.body, descriptionBody(create.body));
  assert.equal(result.description.finalized, true);
});
test('a failed description edit returns created PR without inviting duplicate creation', async () => {
  const { actions } = fixture({ editFailure: true });
  const result = await actions.create({ ...create, prompt: 'Original prompt' });
  assert.equal(result.url, pr.html_url);
  assert.equal(result.description.finalized, false);
});
test('existing PR and concurrent calls do not create duplicates', async () => {
  const { actions, calls } = fixture();
  await Promise.all([actions.create(create), actions.create({ ...create, base: 'release' })]);
  assert.equal(calls.filter(call => call.method === 'POST' && call.endpoint.endsWith('/pulls')).length, 1,
    'Different base targets must still share the head-branch creation lock');
});
test('an already-open branch is reused even when its PR targets a different base', async () => {
  const { actions, calls } = fixture({ existing: true, existingBase: 'release' });
  const context = await actions.context(selection);
  assert.equal(context.existingPullRequest.number, 42);
  assert.equal(context.existingPullRequest.base, 'release');
  assert.equal(context.newPullRequest.reason, 'open-pr');
  const result = await actions.create(create);
  assert.equal(result.existing, true);
  assert.equal(result.base, 'release');
  assert(!calls.some(call => call.method === 'POST' && call.endpoint.endsWith('/pulls')));
  assert(calls.some(call => call.endpoint.includes('head=pony-factor%3Afeature')));
});


test('closed PR with identical starting base blocks a duplicate even with new commits', async () => {
  const { actions, calls } = fixture({ closed: true });
  const context = await actions.context(selection);
  assert.equal(context.newPullRequest.allowed, false);
  assert.equal(context.newPullRequest.reason, 'same-starting-base');
  assert.equal(context.newPullRequest.pullRequest.number, 41);
  await assert.rejects(actions.create(create), /already used this branch starting base/);
  assert(!calls.some(call => call.method === 'POST' && call.endpoint.endsWith('/pulls')));
});
test('recreated branch from a different starting commit permits a new PR', async () => {
  const { actions, calls } = fixture({ closed: true, currentBase: 'd'.repeat(40) });
  const context = await actions.context(selection);
  assert.equal(context.newPullRequest.allowed, true);
  await actions.create(create);
  assert.equal(calls.filter(call => call.method === 'POST' && call.endpoint.endsWith('/pulls')).length, 1);
});
test('empty branch stays blocked even if a prior PR used a different starting base', async () => {
  const { actions, calls } = fixture({ closed: true, currentBase: 'd'.repeat(40), noChanges: true });
  const context = await actions.context(selection);
  assert.equal(context.newPullRequest.reason, 'no-commits');
  await assert.rejects(actions.create(create), /no committed changes/);
  assert(!calls.some(call => call.method === 'POST'));
});
test('unverifiable historical starting base fails closed', async () => {
  const { actions, calls } = fixture({ closed: true, historicalBase: null });
  await assert.rejects(actions.context(selection), /Cannot verify the starting base/);
  await assert.rejects(actions.create(create), /Cannot verify the starting base/);
  assert(!calls.some(call => call.method === 'POST'));
});
test('source metadata is a separate idempotent comment', async () => {
  const { actions, calls } = fixture();
  await actions.create({ ...create, source });
  await actions.comment({ ...selection, source });
  assert.equal(calls.filter(call => call.method === 'POST' && call.endpoint.endsWith('/comments')).length, 1);
  const published = calls.find(call => call.method === 'POST' && call.endpoint.endsWith('/pulls'));
  assert(!published.body.body.includes(source.uuid));
});
test('comment failure retains successful PR creation', async () => {
  const { actions } = fixture({ commentFailure: true });
  const result = await actions.create({ ...create, source });
  assert.equal(result.url, pr.html_url);
  assert.equal(result.source.recorded, false);
});
test('changed heads and empty comparisons cannot publish', async () => {
  for (const options of [{ changed: true }, { noChanges: true }]) {
    const { actions, calls } = fixture(options);
    await assert.rejects(actions.create(create));
    assert(!calls.some(call => call.method === 'POST'));
  }
});
test('repository scope rejects access before querying GitHub', async () => {
  const actions = createActions({ allowedRepositories: ['pony-factor/kefania'], request: () => assert.fail('API should not be called') });
  await assert.rejects(actions.context({ ...selection, repo: 'other' }), /not in/);
});
test('source recorder reports pending PR for Sweetiebot polling', async () => {
  const { actions } = fixture();
  await assert.rejects(actions.comment({ ...selection, source }), /No open pull request found/);
});
