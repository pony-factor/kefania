import { loadUserSession, saveUserSession, clearUserSession } from './user-session.js';

const base = 'https://github.com/';
const apiBase = 'https://api.github.com/';
const validClientId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

async function oauth(path, fields, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(base + path, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields), signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('Cannot reach GitHub authorization. Check your connection and try again.'); }
  if (!response.ok) throw new Error('GitHub authorization service is unavailable. Try again.');
  try { return await response.json(); }
  catch { throw new Error('GitHub authorization returned an invalid response.'); }
}

function authError(error) {
  const messages = {
    device_flow_disabled: 'The GitHub App administrator must enable Device Flow in the app settings.',
    access_denied: 'GitHub authorization was declined. Click Connect GitHub to try again.',
    expired_token: 'GitHub authorization expired. Click Connect GitHub to start over.',
    incorrect_client_credentials: 'The GitHub App Client ID is invalid. Check Developer setup.',
    bad_refresh_token: 'GitHub authorization expired. Reconnect your account.',
  };
  return new Error(messages[error] || 'GitHub authorization failed. Check app setup and try again.');
}

export function createDeviceAuthorization({ fetchImpl = fetch, now = Date.now, load = loadUserSession, save = saveUserSession, clear = clearUserSession } = {}) {
  let pending;
  const start = async clientId => {
    if (!validClientId(clientId)) throw new Error('Enter the GitHub App Client ID from its settings.');
    pending = undefined;
    const result = await oauth('login/device/code', { client_id: clientId }, fetchImpl);
    if (result.error) throw authError(result.error);
    if (typeof result.device_code !== 'string' || !/^[A-Z0-9-]{8,20}$/.test(result.user_code || '')) {
      throw new Error('GitHub did not provide a valid authorization code.');
    }
    const interval = Math.max(5, Number(result.interval) || 5);
    pending = { clientId, code: result.device_code, expiresAt: now() + Math.min(900, Number(result.expires_in) || 900) * 1000,
      interval, nextPoll: now() + interval * 1000 };
    return { userCode: result.user_code, verificationUrl: 'https://github.com/login/device',
      expiresAt: pending.expiresAt, pollAfterMs: interval * 1000 };
  };
  const poll = async () => {
    if (!pending) throw new Error('Click Connect GitHub to start authorization.');
    if (now() >= pending.expiresAt) { pending = undefined; throw authError('expired_token'); }
    if (now() < pending.nextPoll) return { pending: true, pollAfterMs: pending.nextPoll - now() };
    const flow = pending;
    flow.nextPoll = now() + flow.interval * 1000;
    const result = await oauth('login/oauth/access_token', {
      client_id: flow.clientId, device_code: flow.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, fetchImpl);
    if (pending !== flow) return { pending: true, pollAfterMs: flow.interval * 1000 };
    if (result.error === 'authorization_pending') return { pending: true, pollAfterMs: flow.interval * 1000 };
    if (result.error === 'slow_down') {
      flow.interval = Math.max(flow.interval + 5, Number(result.interval) || flow.interval + 5);
      flow.nextPoll = now() + flow.interval * 1000;
      return { pending: true, pollAfterMs: flow.interval * 1000 };
    }
    if (result.error || typeof result.access_token !== 'string') {
      pending = undefined;
      throw authError(result.error);
    }
    const session = { clientId: flow.clientId, accessToken: result.access_token,
      refreshToken: result.refresh_token || '', expiresAt: result.expires_in ? now() + result.expires_in * 1000 : null };
    pending = undefined;
    await save(session);
    return { connected: true };
  };
  const disconnect = async () => { pending = undefined; await clear(); };
  return { start, poll, disconnect };
}

export function createUserRequest({ fetchImpl = fetch, now = Date.now, load = loadUserSession, save = saveUserSession } = {}) {
  let refreshPromise;
  const getSession = async () => {
    const session = await load();
    if (!session?.accessToken) throw new Error('GitHub account not connected. Connect GitHub in the local Kefania setup page.');
    if (session.expiresAt && session.expiresAt < now() + 60000) {
      if (!session.refreshToken) throw new Error('GitHub authorization expired. Reconnect from Kefania setup.');
      if (!refreshPromise) refreshPromise = (async () => {
        const response = await oauth('login/oauth/access_token', {
          client_id: session.clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken,
        }, fetchImpl);
        if (response.error || !response.access_token) throw authError(response.error);
        const updated = { clientId: session.clientId, accessToken: response.access_token,
          refreshToken: response.refresh_token || session.refreshToken,
          expiresAt: response.expires_in ? now() + response.expires_in * 1000 : null };
        await save(updated);
        return updated;
      })().finally(() => { refreshPromise = undefined; });
      return refreshPromise;
    }
    return session;
  };
  const request = async (endpoint, { method = 'GET', body } = {}) => {
    const session = await getSession();
    let response;
    try {
      response = await fetchImpl(apiBase + endpoint, {
        method, headers: { Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kefania',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error('GitHub request failed or timed out. Check whether a write succeeded before retrying.'); }
    if (!response.ok) {
      const error = new Error('GitHub user request failed (HTTP ' + response.status + '). Check your account and repository permissions.');
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return {};
    try { return await response.json(); }
    catch { throw new Error('GitHub returned an invalid response.'); }
  };
  request.status = async () => ({ githubAuth: 'user', githubLogin: (await request('user')).login, attribution: 'user' });
  request.repositories = async () => {
    const repos = [];
    for (let page = 1; page <= 10; page++) {
      const installations = await request('user/installations?per_page=100&page=' + page);
      for (const installation of installations.installations || []) {
        for (let child = 1; child <= 10; child++) {
          const result = await request('user/installations/' + installation.id + '/repositories?per_page=100&page=' + child);
          repos.push(...(result.repositories || []));
          if ((result.repositories || []).length < 100) break;
        }
      }
      if ((installations.installations || []).length < 100) break;
    }
    return [...new Map(repos.map(repo => [repo.full_name, repo])).values()];
  };
  return request;
}

export const githubDeviceAuthorization = createDeviceAuthorization();
export const githubUserRequest = createUserRequest();