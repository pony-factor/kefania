#!/usr/bin/env node
// Run interactively by the user. Never print or persist the key in a file.
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createPrivateKey } from 'node:crypto';
import { createAppRequest } from './github.js';
import { saveAppCredentials } from './app-credentials.js';

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (process.platform !== 'darwin') throw new Error('This setup command uses macOS Keychain. On other platforms, supply the documented app environment variables.');
  const appId = (await terminal.question('GitHub App ID [4871148 for codex-pony]: ')).trim() || '4871148';
  const supplied = (await terminal.question('Private-key file path [~/Downloads/codex-pony.2026-10-09.private-key.pem]: ')).trim()
    || '~/Downloads/codex-pony.2026-10-09.private-key.pem';
  const filename = supplied.startsWith('~/') ? resolve(homedir(), supplied.slice(2)) : resolve(supplied);
  let privateKey;
  try { privateKey = await readFile(filename, 'utf8'); createPrivateKey(privateKey); }
  catch { throw new Error('Cannot load a valid private key from the selected file. Check its path and PEM format.'); }
  const app = createAppRequest({ env: { KEFANIA_GITHUB_APP_ID: appId, KEFANIA_GITHUB_PRIVATE_KEY: privateKey } });
  const installations = (await app.installations()).filter(item => !item.suspended_at);
  if (!installations.length) throw new Error('Install codex-pony on the target account first: https://github.com/settings/apps/codex-pony/installations');
  console.log('Found installations for: ' + installations.map(item => item.account.login).join(', '));
  await app.status();
  await saveAppCredentials({ appId, privateKey });
  console.log('Saved in macOS Keychain. Restart the Kefania MCP server. New local PR runs will use codex-pony automatically.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { terminal.close(); }
