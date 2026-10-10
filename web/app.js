const byId = id => document.getElementById(id);
let csrf = '';
let settings;
let repositories = [];
let authorizationActive = false;

function message(id, text, kind = '') {
  const element = byId(id);
  element.textContent = text;
  element.className = 'message ' + kind;
}
async function api(path, payload) {
  const response = await fetch('/api/' + path, payload === undefined
    ? { cache: 'no-store', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Kefania-CSRF': csrf },
        body: JSON.stringify(payload) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Something went wrong. Try again.');
  return value;
}
function setConnection(connection) {
  const ok = Boolean(connection?.connected);
  byId('connection-dot').classList.toggle('connected', ok);
  const provider = connection?.githubAuth;
  const identity = connection?.githubLogin || '';
  byId('connection-state').textContent = ok
    ? 'Connected as @' + identity + (provider === 'user' ? ' · your account' : provider === 'app' ? ' · GitHub App bot' : ' · gh CLI fallback')
    : 'Not connected — authorize on GitHub';
  byId('disconnect').hidden = provider !== 'user';
  byId('connect').textContent = provider === 'user' ? 'Reconnect GitHub' : 'Connect GitHub';
}
function renderRepositories() {
  const list = byId('repo-list');
  const selected = new Set(settings.repositories);
  list.replaceChildren();
  if (!repositories.length) {
    const empty = document.createElement('span');
    empty.className = 'subtle';
    empty.textContent = 'No accessible repositories found. Check the app installation, permissions, or CLI sign-in.';
    list.append(empty);
  }
  for (const repo of repositories) {
    const label = document.createElement('label');
    label.className = 'repo-item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = repo.name;
    box.checked = selected.has(repo.name) && repo.canPush;
    box.disabled = !repo.canPush;
    box.addEventListener('change', updateDefaultOptions);
    const name = document.createElement('span');
    name.textContent = repo.name + (repo.canPush ? '' : ' · read-only');
    label.append(box, name);
    list.append(label);
  }
  updateDefaultOptions();
}
function selectedRepositories() {
  return [...byId('repo-list').querySelectorAll('input:checked')].map(element => element.value);
}
function updateDefaultOptions() {
  const select = byId('default-repo');
  const previous = select.value || settings.selectedRepository;
  const selected = selectedRepositories();
  select.replaceChildren(new Option('Choose a repository', ''));
  for (const name of selected) select.append(new Option(name, name));
  select.value = selected.includes(previous) ? previous : (selected[0] || '');
}
async function refreshRepositories() {
  message('repo-message', 'Checking repository access…');
  try {
    repositories = (await api('repositories')).repositories;
    renderRepositories();
    message('repo-message', repositories.length ? 'Select repositories and save preferences below.' : 'Nothing available yet. Check GitHub App installation or gh CLI.', '');
  } catch (error) { message('repo-message', error.message, 'error'); }
}
async function getConnection() {
  const payload = await api('bootstrap');
  csrf = payload.csrf;
  settings = payload.settings;
  byId('client-id').value = settings.clientId || '';
  byId('length').value = settings.length;
  byId('tone').value = settings.tone;
  byId('instructions').value = settings.instructions;
  setConnection(payload.connection);
  await refreshRepositories();
}
function newPreferences() {
  const names = selectedRepositories();
  const selectedRepository = byId('default-repo').value;
  return { length: byId('length').value, tone: byId('tone').value,
    instructions: byId('instructions').value, repositories: names,
    selectedRepository: names.includes(selectedRepository) ? selectedRepository : '',
    clientId: byId('client-id').value.trim() };
}
byId('save').addEventListener('click', async () => {
  const button = byId('save');
  button.disabled = true;
  message('save-message', 'Saving…');
  try {
    settings = (await api('preferences', newPreferences())).settings;
    message('save-message', 'Saved. Your preferences will apply to new PR drafts.', 'success');
  } catch (error) { message('save-message', error.message, 'error'); }
  finally { button.disabled = false; }
});

async function pollAuthorization() {
  if (!authorizationActive) return;
  try {
    const result = await api('poll', {});
    if (result.connected) {
      authorizationActive = false;
      byId('authorization').hidden = true;
      setConnection(result.connection);
      message('connect-message', 'GitHub connected. Choose repositories below.', 'success');
      await refreshRepositories();
      return;
    }
    if (authorizationActive) setTimeout(pollAuthorization, Math.max(1000, result.pollAfterMs || 5000));
  } catch (error) {
    authorizationActive = false;
    byId('auth-progress').textContent = error.message;
    message('connect-message', error.message, 'error');
  }
}
byId('connect').addEventListener('click', async () => {
  if (authorizationActive) { message('connect-message', 'Complete the current GitHub authorization first.'); return; }
  const button = byId('connect');
  button.disabled = true;
  message('connect-message', 'Requesting a one-time authorization code…');
  try {
    const result = await api('connect', { clientId: byId('client-id').value.trim() });
    byId('auth-code').textContent = result.userCode;
    byId('authorize-link').href = 'https://github.com/login/device';
    byId('authorization').hidden = false;
    byId('auth-progress').textContent = 'Open GitHub, enter the code, and approve access. This page checks automatically.';
    message('connect-message', 'Authorize in the GitHub tab using the code shown here.');
    authorizationActive = true;
    setTimeout(pollAuthorization, result.pollAfterMs || 5000);
  } catch (error) {
    message('connect-message', error.message, 'error');
    if (!byId('client-id').value.trim()) byId('client-id').closest('details').open = true;
  } finally { button.disabled = false; }
});
byId('disconnect').addEventListener('click', async () => {
  authorizationActive = false;
  try {
    const result = await api('disconnect', {});
    byId('authorization').hidden = true;
    setConnection(result.connection);
    message('connect-message', 'Account disconnected locally. Revoke GitHub authorization separately in GitHub settings if desired.', 'success');
    await refreshRepositories();
  } catch (error) { message('connect-message', error.message, 'error'); }
});
byId('refresh-repos').addEventListener('click', refreshRepositories);
async function runPr(preview) {
  const button = byId(preview ? 'preview' : 'publish');
  if (!preview && !window.confirm('Publish a ready-for-review pull request on GitHub?')) return;
  button.disabled = true;
  const output = byId('pr-result');
  output.textContent = preview ? 'Drafting a preview from the published diff…' : 'Drafting and publishing…';
  try {
    const result = await api('pr', { repository: byId('default-repo').value,
      head: byId('head').value, base: byId('base').value, preview });
    output.replaceChildren();
    if (preview) {
      const title = document.createElement('h3');
      title.textContent = result.title;
      const body = document.createElement('pre');
      body.textContent = result.body;
      body.style.whiteSpace = 'pre-wrap';
      output.append(title, body);
    } else {
      const link = document.createElement('a');
      const url = new URL(result.url);
      if (url.origin !== 'https://github.com') throw new Error('GitHub returned an unexpected PR URL.');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'PR #' + result.number;
      output.append(link, document.createTextNode(result.existing ? ' · Already open' : ' · Ready for review'));
    }
  } catch (error) { output.textContent = error.message; }
  finally { button.disabled = false; }
}
byId('preview').addEventListener('click', () => runPr(true));
byId('publish').addEventListener('click', () => runPr(false));
getConnection().catch(error => {
  message('connect-message', 'Setup could not load: ' + error.message, 'error');
  byId('connection-state').textContent = 'Setup unavailable';
});