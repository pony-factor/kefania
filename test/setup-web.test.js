import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupServer } from '../src/setup-web.js';
import { loadPreferences, savePreferences, writingInstructions } from '../src/preferences.js';
import { CODEX_PONY_CLIENT_ID } from '../src/app-settings.js';

test('preferences persist and produce effective PR drafting instructions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kefania-settings-test-'));
  try {
    const path = join(directory, 'preferences.json');
    const original = await loadPreferences({ path });
    assert.equal(original.length, 'balanced');
    const changed = { length: 'concise', tone: 'conversational', instructions: 'Use short sentences.',
      repositories: ['example/demo'], selectedRepository: 'example/demo', clientId: 'Iv123456789' };
    await savePreferences(changed, { path });
    assert.deepEqual(await loadPreferences({ path }), changed);
    assert.match(writingInstructions(await loadPreferences({ path })), /Use short sentences/);
    await assert.rejects(savePreferences({ ...changed, repositories: ['../../secret'] }, { path }), /valid repositories/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('fresh setup fills the public Client ID and connects without asking users to paste it', async () => {
  let settings = { length: 'balanced', tone: 'professional', instructions: '',
    repositories: [], selectedRepository: '', clientId: '' };
  let received;
  const server = createSetupServer({
    github: { status: async () => ({ githubLogin: 'alice', githubAuth: 'cli' }) },
    preferences: { load: async () => settings, save: async value => { settings = value; } },
    authorization: { start: async clientId => { received = clientId; return { userCode: 'ABCD-EFGH' }; } },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    const bootstrap = await (await fetch(address + '/api/bootstrap')).json();
    assert.equal(bootstrap.settings.clientId, process.env.KEFANIA_GITHUB_CLIENT_ID || CODEX_PONY_CLIENT_ID);
    const response = await fetch(address + '/api/connect', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kefania-CSRF': bootstrap.csrf }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(received, bootstrap.settings.clientId);
    assert.equal(settings.clientId, received);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('setup exposes working UI, status, repos, CSRF and safe preview without GitHub PR writes', async () => {
  let settings = { length: 'balanced', tone: 'professional', instructions: '',
    repositories: ['example/demo'], selectedRepository: 'example/demo', clientId: 'Iv123456789' };
  const used = [];
  let resets = 0;
  const server = createSetupServer({
    github: {
      status: async () => ({ githubLogin: 'alice', githubAuth: 'user' }),
      repositories: async () => [{ full_name: 'example/demo', permissions: { push: true } }],
      reset: () => { resets++; },
    },
    authorization: {
      start: async () => ({ userCode: 'ABCD-EFGH', verificationUrl: 'https://github.com/login/device', pollAfterMs: 5000 }),
      poll: async () => ({ connected: true }),
      disconnect: async () => {},
    },
    preferences: { load: async () => settings, save: async value => { settings = value; return value; } },
    draftPr: async input => {
      used.push(input);
      if (!input.draftOnly) assert.fail('Do not create real PRs in UI tests');
      return { title: '🔧 Preview', body: 'No footer.', published: false };
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  try {
    const html = await (await fetch(address)).text();
    assert.match(html, /Connect GitHub/);
    assert.match(html, /Writing style/);
    const bootstrap = await (await fetch(address + '/api/bootstrap')).json();
    assert.equal(bootstrap.connection.githubLogin, 'alice');
    assert(!JSON.stringify(bootstrap).includes('github_token'));
    const repos = await (await fetch(address + '/api/repositories')).json();
    assert.equal(repos.repositories[0].name, 'example/demo');
    assert.equal(resets, 1, 'Repository refresh must reload credentials and installation permissions');
    const post = (endpoint, body, headers = {}) => fetch(address + '/api/' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Kefania-CSRF': bootstrap.csrf, ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('preferences', { ...settings, tone: 'formal' }, { 'X-Kefania-CSRF': 'bad' })).status, 403);
    assert.equal((await post('preferences', { ...settings, tone: 'formal' })).status, 200);
    assert.equal(settings.tone, 'formal');
    const preview = await (await post('pr', { repository: 'example/demo', head: 'feature', base: 'main', preview: true })).json();
    assert.equal(preview.body, 'No footer.');
    assert.equal(used.length, 1);
    assert.equal(used[0].draftOnly, true);
    const connect = await (await post('connect', { clientId: 'Iv123456789' })).json();
    assert.equal(connect.userCode, 'ABCD-EFGH');
    const poll = await (await post('poll', {})).json();
    assert.equal(poll.connected, true);
    assert.equal(resets, 2);
    assert.equal((await fetch(address + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
