import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/pull-requests.js';
import { contextInputSchema, publishInputSchema } from '../src/server.js';
import { runLocalPullRequest } from '../src/local-pr.js';
import { hostedActions } from '../src/hosted.js';

const sha = 'a'.repeat(40), changed = 'b'.repeat(40);
const target = { owner: 'upstream', repo: 'project', headRepository: 'contributor/project', head: 'fix-bug', base: 'main' };
const draft = { ...target, expectedHeadSha: sha, title: '🐛 Fix upstream behavior', body: 'Fix a real problem.' };
const upstreamPr = { number: 8, html_url: 'https://github.com/upstream/project/pull/8',
  head: { ref: 'fix-bug', label: 'contributor:fix-bug', repo: { full_name: 'contributor/project' } },
  base: { ref: 'main' } };

function fixture({ existing = false, move = false, unrelated = false, noDiff = false, writeFailure = false,
  wrongForkPr = false } = {}) {
  const calls = [];
  const request = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (endpoint === 'repos/contributor/project') return { full_name: 'contributor/project', fork: true,
      parent: { full_name: unrelated ? 'other/project' : 'upstream/project' } };
    if (endpoint === 'repos/contributor/project/commits/fix-bug') return { sha: move ? changed : sha };
    if (endpoint.startsWith('repos/upstream/project/compare/')) return { ahead_by: noDiff ? 0 : 1, behind_by: 4,
      head_commit: { sha }, base_commit: { sha: changed },
      merge_base_commit: { sha: changed }, total_commits: 1, commits: [{}],
      files: [{ filename: 'src/fix.js', status: 'modified', patch: '+ fix', additions: 1, deletions: 0 }] };
    if (endpoint.startsWith('repos/upstream/project/pulls?')) {
      if (new URLSearchParams(endpoint.split('?')[1]).get('state') === 'closed') return [];
      if (!existing && !wrongForkPr) return [];
      return wrongForkPr ? [{ ...upstreamPr, head: { ...upstreamPr.head,
        repo: { full_name: 'contributor/other-fork' } } }] : [upstreamPr];
    }
    if (endpoint === 'repos/upstream/project/pulls' && options.method === 'POST') {
      if (writeFailure) throw new Error('GitHub returned an uncertain upstream write error.');
      return upstreamPr;
    }
    if (endpoint === 'repos/upstream/project/pulls/8' && options.method === 'PATCH') return upstreamPr;
    throw Error('Unexpected API call: ' + endpoint);
  };
  return { calls, actions: createActions({ request, upstreamRequest: request, allowedRepositories: ['upstream/project'] }) };
}

test('the MCP schemas accept a separate fork without retargeting the upstream', () => {
  assert.equal(contextInputSchema.parse(target).headRepository, target.headRepository);
  assert.equal(publishInputSchema.parse(draft).headRepository, target.headRepository);
  assert.equal(contextInputSchema.safeParse({ ...target, headRepository: 'invalid:branch' }).success, false);
  assert.equal(contextInputSchema.safeParse({ ...target, head: 'owner:branch' }).success, false);
});

test('upstream context compares across forks and pins the published fork SHA', async () => {
  const { actions, calls } = fixture();
  const context = await actions.context(target);
  assert.equal(context.repository, 'upstream/project');
  assert.equal(context.headRepository, 'contributor/project');
  assert.equal(context.headSha, sha);
  assert.equal(context.aheadBy, 1);
  assert(calls.some(c => c.endpoint.includes('/compare/upstream%3Amain...contributor%3Afix-bug')));
  assert(calls.some(c => c.endpoint === 'repos/contributor/project/commits/fix-bug'));
});

test('upstream PRs use qualified fork heads, head_repo, and original base', async () => {
  const { actions, calls } = fixture();
  const result = await actions.create(draft);
  assert.equal(result.url, upstreamPr.html_url);
  assert.equal(result.repository, 'upstream/project');
  assert.equal(result.headRepository, 'contributor/project');
  const post = calls.find(c => c.method === 'POST');
  assert.equal(post.endpoint, 'repos/upstream/project/pulls');
  assert.equal(post.body.head, 'contributor:fix-bug');
  assert.equal(post.body.head_repo, 'project');
  assert.equal(post.body.base, 'main');
  assert.equal(post.body.draft, false);
});

test('an existing upstream PR is reused only when its fork matches', async () => {
  const first = fixture({ existing: true });
  const existing = await first.actions.create(draft);
  assert.equal(existing.existing, true);
  assert(!first.calls.some(c => c.method === 'POST'));
  const second = fixture({ wrongForkPr: true });
  const created = await second.actions.create(draft);
  assert.equal(created.existing, false);
  assert.equal(second.calls.filter(c => c.method === 'POST').length, 1);
});

test('uncertain upstream writes never automatically retry the POST', async () => {
  const { actions, calls } = fixture({ writeFailure: true });
  await assert.rejects(actions.create(draft), /uncertain/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('invalid fork ancestry, shifted heads, and empty comparisons cannot publish', async () => {
  for (const options of [{ unrelated: true }, { move: true }, { noDiff: true }]) {
    const { actions, calls } = fixture(options);
    await assert.rejects(actions.create(draft));
    assert(!calls.some(c => c.method === 'POST'));
  }
});

test('scope enforcement applies to upstream, not an untrusted target from the head', async () => {
  const { actions, calls } = fixture();
  await assert.rejects(actions.context({ ...target, owner: 'unauthorized' }), /not in/);
  assert.equal(calls.length, 0);
});

test('local prepared drafts keep the fork identity and skip a second model run', async () => {
  const { actions } = fixture();
  const result = await runLocalPullRequest({ repository: 'upstream/project', headRepository: 'contributor/project',
    head: 'fix-bug', base: 'main', preparedDraft: { title: draft.title, body: draft.body },
    expectedHeadSha: sha }, { actions, draft() { assert.fail('Already drafted'); } });
  assert.equal(result.url, upstreamPr.html_url);
});

test('hosted users can publish from writable forks without upstream push rights', async () => {
  const seen = [];
  const actions = { async create(args) { seen.push(args); return { published: true }; } };
  const oauth = { async github(_token, endpoint) {
    if (endpoint === 'repos/upstream/project') return { permissions: { pull: true, push: false } };
    if (endpoint === 'repos/contributor/project') return { permissions: { pull: true, push: true } };
    assert.fail('Unexpected authorization lookup');
  } };
  const auth = { scopes: ['kefania:read', 'kefania:publish'], extra: { githubToken: 'token', user: { login: 'contributor' } } };
  const wrapped = hostedActions({ actions, oauth, auth, allowedRepositories: ['upstream/project'] });
  assert.deepEqual(await wrapped.create(draft), { published: true });
  assert.equal(seen.length, 1);
});
