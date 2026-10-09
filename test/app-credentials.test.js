import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppEnvironment, saveAppCredentials } from '../src/app-credentials.js';

test('Keychain setup sends credentials through stdin and verifies stored values', async () => {
  const credentials = { appId: '123', installationId: '456', privateKey: 'ephemeral-test-value' };
  let saved;
  const run = async (args, input) => {
    assert(!args.some(value => value.includes(credentials.privateKey)));
    if (args[0] === '-i') {
      saved = input.trim().split(' -w ')[1];
      assert.deepEqual(JSON.parse(Buffer.from(saved, 'base64')), credentials);
      return '';
    }
    assert.equal(input, undefined);
    return saved + '\n';
  };
  await saveAppCredentials(credentials, run);
  const env = await loadAppEnvironment({}, { platform: 'darwin', run });
  assert.equal(env.KEFANIA_GITHUB_INSTALLATION_ID, '456');
  assert.equal(env.KEFANIA_GITHUB_PRIVATE_KEY, credentials.privateKey);
});
test('environment credentials take precedence and absent Keychain permits fallback', async () => {
  const env = { KEFANIA_GITHUB_APP_ID: '123', KEFANIA_GITHUB_INSTALLATION_ID: '456', KEFANIA_GITHUB_PRIVATE_KEY: 'ephemeral-test-value' };
  assert.equal(await loadAppEnvironment(env, { platform: 'darwin', run: () => assert.fail('Must not access Keychain') }), env);
  assert.deepEqual(await loadAppEnvironment({}, { platform: 'darwin', run: () => { throw new Error('Missing'); } }), {});
  assert.deepEqual(await loadAppEnvironment({}, { platform: 'linux', run: () => assert.fail('Must not access Keychain') }), {});
});
