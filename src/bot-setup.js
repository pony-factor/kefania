import { createPrivateKey } from 'node:crypto';
import { createAppRequest } from './github.js';
import { saveAppCredentials } from './app-credentials.js';

export function createBotSetup({ platform = process.platform, appFactory = createAppRequest,
  save = saveAppCredentials, now = Date.now } = {}) {
  let pending, expiryTimer;
  const clear = () => { pending = undefined; clearTimeout(expiryTimer); };
  return {
    clear,
    async start({ appId, privateKey } = {}) {
      clear();
      if (platform !== 'darwin') throw new Error('Bot setup requires macOS Keychain on this computer.');
      if (!/^\d+$/.test(appId || '') || typeof privateKey !== 'string' || privateKey.length > 16000) {
        throw new Error('Enter a numeric App ID and select its private-key PEM file.');
      }
      try {
        if (createPrivateKey(privateKey).asymmetricKeyType !== 'rsa') throw new Error();
      } catch { throw new Error('Select a valid RSA private-key PEM file downloaded for this GitHub App.'); }
      const app = appFactory({ env: { KEFANIA_GITHUB_APP_ID: appId, KEFANIA_GITHUB_PRIVATE_KEY: privateKey } });
      const installations = (await app.installations()).filter(item => !item.suspended_at)
        .map(item => ({ id: String(item.id), account: item.account.login }));
      if (!installations.length) throw new Error('Install the GitHub App on your account or organization first.');
      pending = { appId, privateKey, installations, expiresAt: now() + 300000 };
      expiryTimer = setTimeout(clear, 300000);
      expiryTimer.unref();
      return { installations };
    },
    async finish() {
      const setup = pending;
      clear();
      if (!setup || now() >= setup.expiresAt) throw new Error('Bot setup expired. Select the private-key file again.');
      const app = appFactory({ env: { KEFANIA_GITHUB_APP_ID: setup.appId,
        KEFANIA_GITHUB_PRIVATE_KEY: setup.privateKey } });
      const status = await app.status();
      await save({ appId: setup.appId, privateKey: setup.privateKey });
      return { githubLogin: status.githubLogin, githubAuth: 'app' };
    },
  };
}
