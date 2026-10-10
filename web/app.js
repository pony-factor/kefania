const byId = id => document.getElementById(id);
let csrf = '';
let settings;
let repositories = [];
let authorizationActive = false;
let currentConnection;

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
  currentConnection = connection;
  const ok = Boolean(connection?.connected);
  byId('connection-dot').classList.toggle('connected', ok);
  const provider = connection?.githubAuth;
  const identity = connection?.githubLogin || '';
  byId('connection-state').textContent = ok
    ? 'Connected as @' + identity + (provider === 'user' ? ' · your account' : provider === 'app' ? ' · GitHub App bot' : ' · gh CLI fallback')
    : 'Not connected — authorize on GitHub';
  byId('disconnect').hidden = provider !== 'user';
  byId('connect').textContent = provider === 'app' ? 'Check GitHub setup' : 'Connect GitHub';
  byId('connect-account').textContent = provider === 'user' ? 'Reconnect your account' : 'Connect your account';
  const missing = connection?.installations?.filter(item => item.missingPermissions?.length) || [];
  message('bot-access-message', missing.length
    ? 'Bot key saved. GitHub permissions still need approval for ' + missing.map(item => item.account).join(', ') + '.'
    : '', missing.length ? 'error' : '');
  byId('access-setup').hidden = provider !== 'app' || (!missing.length && repositories.length > 0);
  const links = byId('installation-links');
  links.replaceChildren();
  for (const installation of connection?.installations || []) {
    if (!installation.settingsUrl) continue;
    const url = new URL(installation.settingsUrl);
    if (url.origin !== 'https://github.com') continue;
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = 'Configure ' + installation.account;
    link.className = 'text-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
}
function renderRepositories() {
  const list = byId('repo-list');
  const selected = new Set(settings.repositories);
  list.replaceChildren();
  if (!repositories.length) {
    const empty = document.createElement('span');
    empty.className = 'subtle';
    empty.textContent = 'No repositories are enabled for this identity. Choose repositories in the GitHub App installation settings, then refresh.';
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
    name.textContent = repo.name + (repo.canPush ? '' : ' · PR creation unavailable');
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
    message('repo-message', repositories.length ? 'Select repositories and save preferences below.' : 'Enable repository access using Choose repositories on GitHub above, then refresh.', '');
    setConnection((await api('bootstrap')).connection);
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
  if (currentConnection?.githubAuth !== 'app') {
    byId('bot-setup').open = true;
    byId('bot-setup').scrollIntoView({ block: 'center', behavior: 'smooth' });
    message('bot-message', 'Select the App’s private-key PEM file, find its installations, then save the bot connection.');
    return;
  }
  byId('connect').disabled = true;
  try { await refreshRepositories(); }
  finally { byId('connect').disabled = false; }
});
byId('connect-account').addEventListener('click', async () => {
  if (authorizationActive) { message('connect-message', 'Complete the current GitHub authorization first.'); return; }
  const button = byId('connect-account');
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
byId('bot-key').addEventListener('change', () => { byId('bot-installations').hidden = true; });
byId('bot-app-id').addEventListener('input', () => { byId('bot-installations').hidden = true; });
byId('bot-find').addEventListener('click', async () => {
  const button = byId('bot-find');
  button.disabled = true;
  byId('bot-installations').hidden = true;
  message('bot-message', 'Checking the App and its installations…');
  try {
    const file = byId('bot-key').files[0];
    if (!file || file.size > 16000) throw new Error('Select a private-key PEM file smaller than 16 KB.');
    const privateKey = await file.text();
    byId('bot-key').value = '';
    const result = await api('bot/start', { appId: byId('bot-app-id').value.trim(), privateKey });
    byId('bot-accounts').textContent = 'Found installations for ' + result.installations.map(item => item.account).join(', ')
      + '. Kefania automatically selects the installation for each PR’s repository.';
    byId('bot-installations').hidden = false;
    message('bot-message', 'Save the bot connection within five minutes. No account selection is needed.');
  } catch (error) { message('bot-message', error.message, 'error'); }
  finally { byId('bot-key').value = ''; button.disabled = false; }
});
byId('bot-save').addEventListener('click', async () => {
  const button = byId('bot-save');
  button.disabled = true;
  message('bot-message', 'Verifying access and saving in Keychain…');
  try {
    const result = await api('bot/finish', {});
    setConnection(result.connection);
    message('bot-message', 'Saved ' + result.bot.githubLogin + ' in macOS Keychain. New local PR runs use the bot; restart any running Kefania MCP server.', 'success');
    await refreshRepositories();
  } catch (error) { message('bot-message', error.message, 'error'); }
  finally { byId('bot-installations').hidden = true; button.disabled = false; }
});
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
