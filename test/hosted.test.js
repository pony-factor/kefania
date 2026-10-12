import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHostedApp } from '../src/hosted.js';
import { createHostedOAuth } from '../src/hosted-oauth.js';

const publicUrl = 'https://publisher.example';
const resource = `${publicUrl}/mcp`, redirectUri = 'https://client.example/callback';
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const selection = { owner: 'owner', repo: 'repo', head: 'topic', base: 'main' };
const sha = 'a'.repeat(40), changedSha = 'b'.repeat(40);
const draft = { ...selection, expectedHeadSha: sha, title: '🔧 Publish the finished draft',
  body: 'Preserve **this Markdown** and the conversation’s reasoning.\n\nNo second drafting run.' };
const config = { publicUrl, clientId: 'public-client-fixture', clientSecret: 'test-only-client-fixture',
  allowedUserIds: ['123'], redirectUris: [redirectUri] };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

async function fixture(t) {
  let time = Date.now();
  const state = { userId: 123, revoked: false, push: true, currentSha: sha, posts: 0,
    failWrite: false, pr: null, sentBody: null, botCalls: 0, userRepoCalls: 0 };
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(options.body);
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url').length, 43);
      assert.equal(body.redirect_uri, `${publicUrl}/oauth/github/callback`);
      return Response.json({ access_token: 'test-user-token', expires_in: 28800 });
    }
    assert.ok(url.startsWith('https://api.github.com/'), 'Only GitHub API calls expected');
    const path = url.slice('https://api.github.com/'.length);
    if (options.headers.Authorization === 'Bearer test-user-token') {
      if (state.revoked) return Response.json({}, { status: 401 });
      if (path === 'user') return Response.json({ id: state.userId, login: 'fixture-user' });
      if (path === 'repos/owner/repo') {
        state.userRepoCalls++;
        return Response.json({ permissions: { pull: true, push: state.push } });
      }
      assert.fail(`Unexpected user-token endpoint: ${path}`);
    }
    state.botCalls++;
    if (path === 'app') return Response.json({ slug: 'codex-pony' });
    if (path === 'repos/owner/repo/installation') return Response.json({ id: 42 });
    if (path === 'app/installations/42/access_tokens') {
      assert.equal(options.method, 'POST');
      return Response.json({ token: 'test-installation-token', expires_at: new Date(Date.now() + 3600000).toISOString() });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-installation-token');
    if (path.startsWith('repos/owner/repo/commits/')) return Response.json({ sha: state.currentSha });
    if (path.startsWith('repos/owner/repo/compare/')) return Response.json({ ahead_by: 1, total_commits: 1,
      commits: [{}], base_commit: { sha: 'c'.repeat(40) },
      merge_base_commit: { sha: 'c'.repeat(40) }, files: [
        { filename: '.env', patch: 'must be withheld' }, { filename: 'src/feature.js', patch: '+change' }] });
    if (path.startsWith('repos/owner/repo/pulls?')) {
      const query = new URLSearchParams(path.split('?')[1]);
      return Response.json(query.get('state') === 'closed' ? [] : state.pr ? [state.pr] : []);
    }
    if (path === 'repos/owner/repo/pulls' && options.method === 'POST') {
      state.posts++;
      if (state.failWrite) return Response.json({ detail: 'upstream-private-detail' }, { status: 503 });
      state.sentBody = JSON.parse(options.body);
      state.pr = { number: 7, html_url: 'https://github.com/owner/repo/pull/7',
        base: { ref: 'main' }, head: { ref: 'topic', label: 'owner:topic' } };
      return Response.json(state.pr);
    }
    assert.fail(`Unexpected bot endpoint: ${path}`);
  };
  const oauth = createHostedOAuth({ ...config, fetchImpl, now: () => time });
  const app = createHostedApp({ ...config, allowedRepositories: ['owner/repo'], oauth, fetchImpl,
    env: { KEFANIA_GITHUB_APP_ID: '1234', KEFANIA_GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) } });
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const request = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
  const json = (path, body, token) => request(path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const tokenRequest = fields => request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields) });
  const register = async () => {
    const response = await json('/register', { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    assert.equal(response.status, 201);
    return response.json();
  };
  const start = async (client, scope = 'kefania:read kefania:publish') => {
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', resource, scope, state: 'client-state' });
    const response = await request('/authorize?' + params);
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return { state: url.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const callback = auth => request('/oauth/github/callback?' + new URLSearchParams({ state: auth.state, code: 'fixture-github-code' }),
    { headers: { Cookie: auth.cookie } });
  const code = async client => {
    const auth = await start(client);
    const response = await callback(auth);
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.searchParams.get('state'), 'client-state');
    assert.ok(url.searchParams.get('code'));
    return url.searchParams.get('code');
  };
  const exchange = (client, codeValue, extra = {}) => tokenRequest({ grant_type: 'authorization_code', client_id: client.client_id,
    code: codeValue, code_verifier: verifier, redirect_uri: redirectUri, resource, ...extra });
  const login = async (scope = 'kefania:read kefania:publish') => {
    const client = await register(), auth = await start(client, scope), result = await callback(auth);
    const codeValue = new URL(result.headers.get('location')).searchParams.get('code');
    const response = await exchange(client, codeValue);
    assert.equal(response.status, 200);
    return { client, ...(await response.json()) };
  };
  return { state, oauth, request, json, tokenRequest, register, start, callback, code, exchange, login,
    base, advance(ms) { time += ms; } };
}

test('hosted metadata, full PKCE OAuth, REST evidence and unchanged bot publication', async t => {
  const f = await fixture(t);
  const anonymous = await f.json('/api/context', selection);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
  const metadata = await (await f.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource, resource);
  const serverMetadata = await (await f.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(serverMetadata.issuer, publicUrl + '/');
  assert.deepEqual(serverMetadata.code_challenge_methods_supported, ['S256']);
  const auth = await f.login();
  assert.notEqual(auth.access_token, 'test-user-token');
  const context = await (await f.json('/api/context', selection, auth.access_token)).json();
  assert.equal(context.headSha, sha);
  assert.equal(context.files[0].patch, undefined);
  assert.match(context.files[0].omitted, /Secret-bearing/);
  const response = await f.json('/api/pull-requests', draft, auth.access_token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).number, 7);
  assert.equal(f.state.posts, 1);
  assert.equal(f.state.sentBody.title, draft.title);
  assert.equal(f.state.sentBody.body, draft.body);
  assert.equal(f.state.sentBody.draft, false);
  const duplicate = await f.json('/api/pull-requests', draft, auth.access_token);
  assert.equal((await duplicate.json()).existing, true);
  assert.equal(f.state.posts, 1);
});

test('OAuth refuses arbitrary redirects, bad browser state, unapproved accounts and revoked GitHub authorization', async t => {
  const f = await fixture(t);
  assert.equal((await f.json('/register', { redirect_uris: ['https://attacker.example/callback'] })).status, 400);
  const client = await f.register(), auth = await f.start(client);
  const invalid = await f.request('/oauth/github/callback?state=' + auth.state + '&code=fixture');
  assert.equal(invalid.status, 400);
  f.state.userId = 999;
  const denied = new URL((await f.callback(auth)).headers.get('location'));
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.get('code'), null);
  f.state.userId = 123;
  const session = await f.login();
  f.state.revoked = true;
  assert.equal((await f.json('/api/context', selection, session.access_token)).status, 401);
  assert.equal(f.state.botCalls, 0);
});

test('PKCE, client, resource, redirect and one-use authorization code bindings are enforced by HTTP', async t => {
  const f = await fixture(t), client = await f.register(), other = await f.register();
  const code = await f.code(client);
  assert.equal((await f.exchange(client, code, { code_verifier: 'b'.repeat(64) })).status, 400);
  assert.equal((await f.exchange(other, code)).status, 400);
  assert.equal((await f.exchange(client, code, { resource: 'https://attacker.example/mcp' })).status, 400);
  assert.equal((await f.exchange(client, code, { redirect_uri: 'https://attacker.example/callback' })).status, 400);
  assert.equal((await f.exchange(client, code)).status, 200);
  assert.equal((await f.exchange(client, code)).status, 400);
});

test('pending authorizations, authorization codes and access tokens expire; refresh rotates and revoke kills the session', async t => {
  const f = await fixture(t), client = await f.register(), pending = await f.start(client);
  f.advance(10 * 60000 + 1);
  assert.equal((await f.callback(pending)).status, 400);
  const code = await f.code(client);
  f.advance(60001);
  assert.equal((await f.exchange(client, code)).status, 400);
  const auth = await f.login();
  f.advance(15 * 60000 + 1);
  assert.equal((await f.json('/api/context', selection, auth.access_token)).status, 401);
  const fields = { grant_type: 'refresh_token', client_id: auth.client.client_id, refresh_token: auth.refresh_token, resource };
  const refreshed = await f.tokenRequest(fields);
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.equal((await f.tokenRequest(fields)).status, 400);
  assert.equal((await f.json('/api/context', selection, next.access_token)).status, 200);
  await f.request('/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: auth.client.client_id, token: next.refresh_token }) });
  assert.equal((await f.json('/api/context', selection, next.access_token)).status, 401);
});

test('refresh token is consumed exactly once even when two clients race', async t => {
  const f = await fixture(t), auth = await f.login();
  const results = await Promise.allSettled([
    f.oauth.exchangeRefreshToken(auth.client, auth.refresh_token, undefined, new URL(resource)),
    f.oauth.exchangeRefreshToken(auth.client, auth.refresh_token, undefined, new URL(resource)),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
});

test('scope, repository membership, write permission, changed heads, and browser origins block publication', async t => {
  const f = await fixture(t), readOnly = await f.login('kefania:read');
  assert.equal((await f.json('/api/pull-requests', draft, readOnly.access_token)).status, 400);
  const auth = await f.login();
  assert.equal((await f.json('/api/context', { ...selection, repo: 'outside' }, auth.access_token)).status, 400);
  f.state.push = false;
  assert.equal((await f.json('/api/pull-requests', draft, auth.access_token)).status, 400);
  f.state.push = true;
  f.state.currentSha = changedSha;
  assert.equal((await f.json('/api/pull-requests', draft, auth.access_token)).status, 400);
  assert.equal((await f.json('/api/pull-requests', { ...draft, expectedHeadSha: undefined }, auth.access_token)).status, 400);
  const browser = await f.request('/api/pull-requests', { method: 'POST', headers: { Origin: 'https://attacker.example',
    Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
  assert.equal(browser.status, 403);
  assert.equal(f.state.posts, 0);
});

test('uncertain bot write is not retried and never exposes upstream details', async t => {
  const f = await fixture(t), auth = await f.login();
  f.state.failWrite = true;
  const response = await f.json('/api/pull-requests', draft, auth.access_token);
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /upstream-private-detail|test-installation-token|test-user-token/);
  assert.equal(f.state.posts, 1);
});

test('real MCP client authenticates and publishes through the same hosted OAuth and bot route', async t => {
  const f = await fixture(t), auth = await f.login();
  const client = new Client({ name: 'hosted-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(f.base + '/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${auth.access_token}` } } }));
  const context = await client.callTool({ name: 'github_get_pull_request_context', arguments: selection });
  assert.equal(JSON.parse(context.content[0].text).headSha, sha);
  const created = await client.callTool({ name: 'github_create_pull_request', arguments: draft });
  assert.equal(created.isError, undefined);
  assert.equal(JSON.parse(created.content[0].text).number, 7);
  assert.equal(f.state.posts, 1);
  assert.equal(f.state.sentBody.body, draft.body);
});
