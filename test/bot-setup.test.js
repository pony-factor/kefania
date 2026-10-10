import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createBotSetup } from '../src/bot-setup.js';
import { createSetupServer } from '../src/setup-web.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' });
const makeApp = ({ env }) => ({
  installations: async () => [{ id: 123, account: { login: 'example' } },
    { id: 456, account: { login: 'suspended' }, suspended_at: '2026-01-01' }],
  status: async () => {
    assert.equal(env.KEFANIA_GITHUB_INSTALLATION_ID, undefined);
    return { githubLogin: 'codex-pony[bot]', githubAuth: 'app' };
  },
});

test('bot setup validates installation before saving, returns no credentials, and consumes pending setup', async () => {
  let saved;
  const setup = createBotSetup({ platform: 'darwin', appFactory: makeApp, save: async value => { saved = value; } });
  const start = await setup.start({ appId: '4871148', privateKey });
  assert.deepEqual(start, { installations: [{ id: '123', account: 'example' }] });
  assert.equal(saved, undefined);
  const result = await setup.finish({ installationId: '123' });
  assert.deepEqual(result, { githubLogin: 'codex-pony[bot]', githubAuth: 'app' });
  assert.equal(saved.privateKey, privateKey);
  assert.equal(saved.installationId, undefined);
  await assert.rejects(setup.finish({ installationId: '123' }), /expired/);
});

test('invalid keys, unsupported platforms, cleared and expired setup never save', async () => {
  let now = 0;
  const setup = createBotSetup({ platform: 'darwin', appFactory: makeApp, now: () => now,
    save: async () => assert.fail('Invalid setup must not save') });
  await assert.rejects(setup.start({ appId: '4871148', privateKey: 'invalid' }), /valid RSA/);
  await setup.start({ appId: '4871148', privateKey });
  setup.clear();
  await assert.rejects(setup.finish(), /expired/);
  await setup.start({ appId: '4871148', privateKey });
  now = 300000;
  await assert.rejects(setup.finish({ installationId: '123' }), /expired/);
  await assert.rejects(createBotSetup({ platform: 'linux' }).start({}), /macOS Keychain/);
});

test('bot HTTP setup requires CSRF, resets provider after saving, and redacts upstream failures', async () => {
  let resets = 0, starts = 0;
  const server = createSetupServer({
    preferences: { load: async () => ({}) },
    github: { status: async () => ({ githubLogin: 'codex-pony[bot]', githubAuth: 'app' }), reset: () => resets++ },
    botSetup: {
      start: async () => { starts++; throw new Error('fixture-secret-never-return'); },
      finish: async () => ({ githubLogin: 'codex-pony[bot]', githubAuth: 'app' }), clear: () => {},
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const { csrf } = await (await fetch(url + '/api/bootstrap')).json();
    const post = (path, token) => fetch(url + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kefania-CSRF': token }, body: '{}' });
    assert.equal((await post('/api/bot/start', 'bad')).status, 403);
    assert.equal(starts, 0);
    const failure = await post('/api/bot/start', csrf);
    assert.equal(failure.status, 400);
    assert(!JSON.stringify(await failure.json()).includes('fixture-secret'));
    const success = await (await post('/api/bot/finish', csrf)).json();
    assert.equal(success.connection.githubAuth, 'app');
    assert.equal(resets, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
