import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createAppRequest } from '../src/github.js';
import { createActions } from '../src/pull-requests.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { KEFANIA_GITHUB_APP_ID: '123', KEFANIA_GITHUB_INSTALLATION_ID: '456',
  KEFANIA_GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
function fixture({ slug = 'codex-pony', failWrite = false } = {}) {
  let time = Date.parse('2026-10-09T12:00:00Z'), tokens = 0;
  const calls = [];
  const request = createAppRequest({ env, now: () => time, fetchImpl: async (url, options) => {
    const endpoint = url.replace('https://api.github.com/', '');
    calls.push({ endpoint, options });
    if (endpoint === 'app' || endpoint.endsWith('/access_tokens')) {
      const jwt = options.headers.Authorization.slice(7), [header, payload, signature] = jwt.split('.');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${header}.${payload}`);
      assert(verifier.verify(publicKey, Buffer.from(signature, 'base64url')));
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.iss, '123');
      assert(claims.iat < time / 1000 && claims.exp > time / 1000 && claims.exp < time / 1000 + 600);
      return { ok: true, json: async () => endpoint === 'app' ? { slug } : {
        token: `fixture-${++tokens}`, expires_at: new Date(time + 3600000).toISOString() } };
    }
    assert.match(options.headers.Authorization, /^Bearer fixture-/);
    if (failWrite && options.method === 'POST') return { ok: false, status: 401 };
    return { ok: true, json: async () => ({ html_url: 'https://github.com/example/demo/issues/1#issuecomment-2' }) };
  } });
  return { request, calls, advance: () => { time += 3600000; } };
}

test('app JWT exchange, shared refresh, and comment requests use installation identity', async () => {
  const { request, calls, advance } = fixture();
  await Promise.all([request('repos/example/demo/issues/1/comments', { method: 'POST', body: { body: 'Comment' } }), request('repos/example/demo/pulls')]);
  assert.equal(calls.filter(call => call.endpoint.endsWith('/access_tokens')).length, 1);
  advance();
  await Promise.all([request('repos/example/demo/pulls'), request('repos/example/demo/pulls')]);
  assert.equal(calls.filter(call => call.endpoint.endsWith('/access_tokens')).length, 2);
  assert.equal(JSON.parse(calls.find(call => call.endpoint.endsWith('/comments')).options.body).body, 'Comment');
});
test('status checks installation access rather than the user endpoint', async () => {
  const { request, calls } = fixture();
  const status = await createActions({ request }).status();
  assert.equal(status.githubLogin, 'codex-pony[bot]');
  assert.equal(status.githubAuth, 'app');
  assert(calls.some(call => call.endpoint.startsWith('installation/repositories')));
  assert(!calls.some(call => call.endpoint === 'user'));
});
test('missing credentials and wrong app fail before repository writes', async () => {
  await assert.rejects(createAppRequest({ env: {}, fetchImpl: () => assert.fail('No API request expected') })('repos/example/demo/pulls'), /Configure KEFANIA/);
  const { request, calls } = fixture({ slug: 'different-app' });
  await assert.rejects(request('repos/example/demo/pulls', { method: 'POST' }), /must be codex-pony/);
  assert.equal(calls.length, 1);
});
test('a failed write is not retried and authentication is refreshed on the next call', async () => {
  const { request, calls } = fixture({ failWrite: true });
  await assert.rejects(request('repos/example/demo/issues/1/comments', { method: 'POST' }), /HTTP 401/);
  assert.equal(calls.filter(call => call.endpoint.endsWith('/comments')).length, 1);
  await request('repos/example/demo/pulls');
  assert.equal(calls.filter(call => call.endpoint.endsWith('/access_tokens')).length, 2);
});
