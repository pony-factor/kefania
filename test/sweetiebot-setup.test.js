import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSweetiebotSetup } from '../src/sweetiebot-setup.js';

const exec = promisify(execFile);

async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'kefania-sweetiebot-test-'));
  const owner = join(directory, 'blocktransfer');
  const checkout = join(owner, 'SEC-publications');
  const kefania = join(directory, 'pony-factor', 'kefania');
  await mkdir(checkout, { recursive: true });
  await mkdir(join(kefania, 'src'), { recursive: true });
  await writeFile(join(kefania, 'src', 'local-pr.js'), '// local runner\n');
  await exec('git', ['init', '-q', checkout]);
  await exec('git', ['-C', checkout, 'remote', 'add', 'origin', 'git@github.com:blocktransfer/SEC-publications.git']);
  try { await fn({ checkout, kefania, sibling: join(owner, 'kefania') }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('checks repository identity, local sibling path, and installed runner dependencies', async () => {
  await fixture(async ({ checkout, kefania, sibling }) => {
    const integration = createSweetiebotSetup({ kefaniaPath: kefania });
    const input = { repository: 'blocktransfer/SEC-publications', checkoutPath: checkout };
    const status = await integration.check(input);
    assert.equal(status.siblingPath, sibling);
    assert.equal(status.linkState, 'missing');
    assert.equal(status.dependenciesReady, false);
    assert.equal(status.ready, false);
    await assert.rejects(integration.check({ ...input, repository: 'wrong/repo' }), /matching GitHub origin/);
    await assert.rejects(integration.check({ ...input, checkoutPath: '../relative' }), /absolute path/);
  });
});

test('repair installs dependencies and links the actual Kefania checkout without shell commands', async () => {
  await fixture(async ({ checkout, kefania, sibling }) => {
    const calls = [];
    const integration = createSweetiebotSetup({ kefaniaPath: kefania, command: async (bin, args, opts) => {
      if (bin === 'npm') {
        calls.push({ bin, args, cwd: opts.cwd });
        await mkdir(join(kefania, 'node_modules', 'zod'), { recursive: true });
        await mkdir(join(kefania, 'node_modules', '@modelcontextprotocol', 'sdk'), { recursive: true });
        await writeFile(join(kefania, 'node_modules', 'zod', 'package.json'), '{}');
        await writeFile(join(kefania, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), '{}');
        return '';
      }
      return (await exec(bin, args, opts)).stdout.trim();
    } });
    const input = { repository: 'blocktransfer/SEC-publications', checkoutPath: checkout };
    assert.equal((await integration.repair(input)).ready, true);
    assert.equal(await readlink(sibling), kefania);
    assert.deepEqual(calls, [{ bin: 'npm', args: ['ci', '--ignore-scripts'], cwd: kefania }]);
    await integration.repair(input);
    assert.equal(calls.length, 1, 'a healthy repair does not reinstall dependencies');
  });
});

test('conflicting sibling paths are never overwritten', async () => {
  await fixture(async ({ checkout, kefania, sibling }) => {
    await symlink(checkout, sibling, 'dir');
    const integration = createSweetiebotSetup({ kefaniaPath: kefania,
      command: async (bin, args, options) => (await exec(bin, args, options)).stdout.trim() });
    const input = { repository: 'blocktransfer/SEC-publications', checkoutPath: checkout };
    assert.equal((await integration.check(input)).linkState, 'conflict');
    await assert.rejects(integration.repair(input), /nothing was overwritten/);
    assert.equal(await readlink(sibling), checkout);
  });
});

test('an update refuses dirty or non-main Kefania trees before running pull or npm', async () => {
  await fixture(async ({ checkout, kefania }) => {
    await exec('git', ['init', '-q', kefania]);
    await exec('git', ['-C', kefania, 'checkout', '-q', '-b', 'topic']);
    await exec('git', ['-C', kefania, 'remote', 'add', 'origin', 'https://github.com/pony-factor/kefania.git']);
    const integration = createSweetiebotSetup({ kefaniaPath: kefania });
    await assert.rejects(integration.update({ repository: 'blocktransfer/SEC-publications', checkoutPath: checkout }), /on main/);
  });
});
