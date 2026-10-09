// Browser-only fixture. No GitHub API calls, tokens, private keys or PR writes.
import { createSetupServer } from '../src/setup-web.js';
let connected = false;
let preferences = { length: 'balanced', tone: 'professional', instructions: '',
  clientId: 'Iv123456789', repositories: [], selectedRepository: '' };
const server = createSetupServer({
  github: {
    status: async () => ({ githubAuth: connected ? 'user' : 'cli', githubLogin: connected ? 'sample-user' : 'sample-fallback' }),
    repositories: async () => [{ full_name: 'example/demo', permissions: { push: true } },
      { full_name: 'example/read-only', permissions: { push: false } }],
    reset: () => {},
  },
  authorization: {
    start: async () => ({ userCode: 'ABCD-EFGH', verificationUrl: 'https://github.com/login/device', pollAfterMs: 50 }),
    poll: async () => { connected = true; return { connected: true }; },
    disconnect: async () => { connected = false; },
  },
  preferences: { load: async () => preferences, save: async value => { preferences = value; return value; } },
  draftPr: async input => input.draftOnly
    ? { title: '🖌️ Preview test changes', body: 'Preview-only description.', published: false }
    : { number: 42, url: 'https://github.com/example/demo/pull/42', existing: false },
});
server.listen(0, '127.0.0.1', () => { console.log('http://127.0.0.1:' + server.address().port); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());