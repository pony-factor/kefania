import { spawn } from 'node:child_process';

const service = 'kefania.codex-pony';
// Keychain output remains inside the process; never send it to logs or tools.
export function keychainCommand(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error('macOS Keychain is unavailable.')));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error('Kefania credentials are unavailable in macOS Keychain.')));
    child.stdin.end(input);
  });
}

export async function loadAppEnvironment(env = process.env, { platform = process.platform, run = keychainCommand } = {}) {
  if (env.KEFANIA_GITHUB_APP_ID && env.KEFANIA_GITHUB_PRIVATE_KEY) return env;
  if (platform !== 'darwin') return env;
  try {
    const stored = JSON.parse(Buffer.from((await run(['find-generic-password', '-s', service, '-a', 'codex-pony', '-w'])).trim(), 'base64').toString('utf8'));
    return { ...env,
      KEFANIA_GITHUB_APP_ID: env.KEFANIA_GITHUB_APP_ID || stored.appId,
      KEFANIA_GITHUB_INSTALLATION_ID: env.KEFANIA_GITHUB_INSTALLATION_ID || stored.installationId,
      KEFANIA_GITHUB_PRIVATE_KEY: env.KEFANIA_GITHUB_PRIVATE_KEY || stored.privateKey,
    };
  } catch { return env; }
}

export async function saveAppCredentials(credentials, run = keychainCommand) {
  const encoded = Buffer.from(JSON.stringify(credentials)).toString('base64');
  // Pass the secret over stdin, never in process arguments or shell history.
  await run(['-i'], `add-generic-password -U -s ${service} -a codex-pony -w ${encoded}\n`);
  const stored = await loadAppEnvironment({}, { platform: 'darwin', run });
  if (stored.KEFANIA_GITHUB_PRIVATE_KEY !== credentials.privateKey) throw new Error('Could not verify Keychain storage.');
}
