import { spawn } from 'node:child_process';
import { createSign } from 'node:crypto';
import { loadAppEnvironment } from './app-credentials.js';
import { githubUserRequest } from './user-auth.js';

// gh uses its existing login; credentials never enter tool arguments or logs.
export function githubCliRequest(endpoint, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    if (body !== undefined) args.push('--input', '-');
    const child = spawn(process.env.KEFANIA_GH_COMMAND || 'gh', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', error = '', size = 0, settled = false;
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      failure ? reject(failure) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('GitHub request timed out. Check whether the PR exists before retrying a write.'));
    }, 60000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        child.kill();
        finish(new Error('GitHub response exceeded the size limit. Narrow the branch changes.'));
      } else output += chunk;
    });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', () => finish(new Error('GitHub CLI is unavailable. Install gh and sign in before starting Kefania.')));
    child.on('close', code => {
      if (code !== 0) {
        const status = error.match(/HTTP (\d{3})/)?.[1];
        const failure = new Error(`GitHub request failed${status ? ` (HTTP ${status})` : ''}. Check repository access and gh authentication.`);
        failure.status = Number(status) || undefined;
        return finish(failure);
      }
      try { finish(null, JSON.parse(output)); }
      catch { finish(new Error('GitHub returned an invalid response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// Credentials are supplied by the process environment, never read from files.
export function createAppRequest({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  let appPromise, tokenPromise, cachedToken;
  const api = async (endpoint, authorization, { method = 'GET', body } = {}) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/${endpoint}`, {
        method, headers: { Authorization: `Bearer ${authorization}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'kefania',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error('GitHub App request failed or timed out. Check whether the write succeeded before retrying.'); }
    if (!response.ok) {
      const error = new Error(`GitHub App request failed (HTTP ${response.status}). Check codex-pony installation access and permissions.`);
      error.status = response.status;
      throw error;
    }
    try { return await response.json(); }
    catch { throw new Error('GitHub App returned an invalid response.'); }
  };
  const jwt = () => {
    if (!env.KEFANIA_GITHUB_APP_ID || !env.KEFANIA_GITHUB_PRIVATE_KEY) {
      throw new Error('Configure KEFANIA_GITHUB_APP_ID, KEFANIA_GITHUB_INSTALLATION_ID, and KEFANIA_GITHUB_PRIVATE_KEY for codex-pony. Supply credentials securely through the process environment.');
    }
    const seconds = Math.floor(now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: env.KEFANIA_GITHUB_APP_ID })}`;
    try {
      const signer = createSign('RSA-SHA256');
      signer.update(unsigned);
      return `${unsigned}.${signer.sign(env.KEFANIA_GITHUB_PRIVATE_KEY).toString('base64url')}`;
    } catch { throw new Error('GitHub App private key is invalid. Supply a PEM private key through the process environment.'); }
  };
  const app = async () => {
    if (!appPromise) {
      appPromise = api('app', jwt()).then(value => {
        if (value.slug !== 'codex-pony') throw new Error('Configured GitHub App must be codex-pony.');
        return value;
      }).catch(error => { appPromise = undefined; throw error; });
    }
    return appPromise;
  };
  const token = async () => {
    await app();
    if (!/^\d+$/.test(env.KEFANIA_GITHUB_INSTALLATION_ID || '')) throw new Error('Configure the GitHub App installation with npm run setup:github.');
    if (cachedToken?.expires > now() + 60000) return cachedToken.token;
    if (!tokenPromise) {
      tokenPromise = api(`app/installations/${env.KEFANIA_GITHUB_INSTALLATION_ID}/access_tokens`, jwt(), { method: 'POST' })
        .then(value => {
          const expires = Date.parse(value.expires_at);
          if (!value.token || !Number.isFinite(expires) || expires <= now() + 60000) throw new Error('GitHub returned an invalid installation token.');
          cachedToken = { token: value.token, expires };
          return cachedToken;
        }).finally(() => { tokenPromise = undefined; });
    }
    return (await tokenPromise).token;
  };
  const request = async (endpoint, options) => {
    const authorization = await token();
    try { return await api(endpoint, authorization, options); }
    catch (error) {
      if (error.status === 401) cachedToken = undefined;
      // Never retry a write automatically: GitHub may already have accepted it.
      throw error;
    }
  };
  request.installations = async () => {
    await app();
    const installations = [];
    for (let page = 1; ; page++) {
      const batch = await api(`app/installations?per_page=100&page=${page}`, jwt());
      installations.push(...batch);
      if (batch.length < 100) return installations;
    }
  };
  request.status = async () => {
    await request('installation/repositories?per_page=1');
    return { githubLogin: `${(await app()).slug}[bot]`, githubAuth: 'app', installationId: env.KEFANIA_GITHUB_INSTALLATION_ID };
  };
  return request;
}

export function createGithubRequest({ env = process.env, appRequest, userRequest = githubUserRequest, cliRequest = githubCliRequest } = {}) {
  let selected, resolvedApp;
  const getApp = async () => appRequest || (resolvedApp ||= createAppRequest({ env: await loadAppEnvironment(env) }));
  const cliStatus = async () => ({ githubLogin: (await cliRequest('user')).login, githubAuth: 'cli' });
  const choose = async () => {
    const mode = env.KEFANIA_GITHUB_AUTH || 'auto';
    if (mode === 'cli') return { request: cliRequest, status: cliStatus, method: 'cli' };
    if (mode === 'user') return { request: userRequest, status: userRequest.status, method: 'user' };
    if (mode === 'app') { const app = await getApp(); return { request: app, status: app.status, method: 'app' }; }
    if (mode !== 'auto') throw new Error('KEFANIA_GITHUB_AUTH must be auto, user, app, or cli.');
    if (!selected) {
      selected = (async () => {
        try {
          const app = await getApp();
          await app.status();
          return { request: app, status: app.status, method: 'app' };
        } catch {
          // Prefer bot attribution; select a working fallback before any write.
        }
        try {
          await userRequest.status();
          return { request: userRequest, status: async () => ({ ...await userRequest.status(),
            fallbackFrom: 'app', fallbackReason: 'No authorized GitHub App installation is available.' }), method: 'user' };
        } catch {
          // Select the fallback before any repository write. Never replay a
          // failed write under a different identity: it may have succeeded.
          await cliStatus();
          return { request: cliRequest, status: async () => ({ ...await cliStatus(),
            fallbackFrom: 'app', fallbackReason: 'No authorized GitHub user or App installation is available.' }), method: 'cli' };
        }
      })().catch(error => { selected = undefined; throw error; });
    }
    return selected;
  };
  const request = async (endpoint, options) => (await choose()).request(endpoint, options);
  request.status = async () => (await choose()).status();
  request.reset = () => { selected = undefined; resolvedApp = undefined; };
  request.repositories = async () => {
    const provider = await choose();
    if (provider.method === 'user') return provider.request.repositories();
    const results = [];
    for (let page = 1; page <= 10; page++) {
      const endpoint = provider.method === 'app'
        ? 'installation/repositories?per_page=100&page=' + page
        : 'user/repos?per_page=100&page=' + page + '&affiliation=owner,collaborator,organization_member';
      const response = await provider.request(endpoint);
      const batch = Array.isArray(response) ? response : (response.repositories || []);
      results.push(...batch);
      if (batch.length < 100) break;
    }
    return results;
  };
  return request;
}

export const githubRequest = createGithubRequest();
