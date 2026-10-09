import { spawn } from 'node:child_process';
import { keychainCommand } from './app-credentials.js';

const service = 'kefania.github-user';
let volatileSession = null;

export async function loadUserSession({ platform = process.platform, run = keychainCommand } = {}) {
  if (platform !== 'darwin') return volatileSession;
  try {
    const encoded = (await run(['find-generic-password', '-s', service, '-a', 'github-user', '-w'])).trim();
    const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return typeof value.accessToken === 'string' && typeof value.clientId === 'string' ? value : null;
  } catch { return null; }
}

export async function saveUserSession(value, { platform = process.platform, run = keychainCommand } = {}) {
  if (!value?.accessToken || !value?.clientId) throw new Error('GitHub returned an invalid user session.');
  if (platform !== 'darwin') { volatileSession = value; return; }
  // Keep tokens out of command arguments, logs, source files, URLs, and browser storage.
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64');
  await run(['-i'], 'add-generic-password -U -s ' + service + ' -a github-user -w ' + encoded + '\n');
}

export async function clearUserSession({ platform = process.platform } = {}) {
  volatileSession = null;
  if (platform !== 'darwin') return;
  await new Promise(resolve => {
    const child = spawn('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', 'github-user'], {
      stdio: 'ignore',
    });
    child.on('error', resolve);
    child.on('close', resolve);
  });
}