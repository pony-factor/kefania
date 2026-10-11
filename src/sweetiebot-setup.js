import { access, lstat, realpath, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const defaultCheckout = fileURLToPath(new URL('..', import.meta.url));
const validRepository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function defaultCommand(command, args, options = {}) {
  const { stdout } = await exec(command, args, {
    timeout: 120000, maxBuffer: 256000, ...options,
  });
  return stdout.trim();
}

function githubRemote(url) {
  const match = url.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? (match[1] + '/' + match[2]).toLowerCase() : null;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function linkState(path, source) {
  try {
    await lstat(path);
    return await realpath(path) === source ? 'ready' : 'conflict';
  } catch (error) {
    if (error.code === 'ENOENT') {
      // A broken symlink is not an empty destination and must never be replaced.
      try { await lstat(path); return 'conflict'; }
      catch (checkError) { if (checkError.code === 'ENOENT') return 'missing'; throw checkError; }
    }
    throw error;
  }
}

export function createSweetiebotSetup({ kefaniaPath = defaultCheckout, command = defaultCommand } = {}) {
  async function target(input) {
    if (!input || !validRepository.test(input.repository || ''))
      throw new Error('Choose a valid GitHub repository.');
    if (typeof input.checkoutPath !== 'string' || !isAbsolute(input.checkoutPath) || input.checkoutPath.length > 4096)
      throw new Error('Enter the absolute path to the local repository checkout.');
    const checkoutPath = resolve(input.checkoutPath);
    let checkout;
    try {
      checkout = await realpath(checkoutPath);
      const top = await command('git', ['-C', checkout, 'rev-parse', '--show-toplevel']);
      if (await realpath(top) !== checkout) throw new Error('Not the repository root.');
      const origin = await command('git', ['-C', checkout, 'remote', 'get-url', 'origin']);
      if (githubRemote(origin) !== input.repository.toLowerCase()) throw new Error('Unexpected origin.');
    } catch {
      throw new Error('The path must be the root of a local checkout of ' + input.repository + ' with a matching GitHub origin.');
    }
    return { repository: input.repository, checkoutPath, siblingPath: join(dirname(checkoutPath), 'kefania') };
  }

  async function inspect(input) {
    const selection = await target(input);
    const source = await realpath(kefaniaPath);
    const sibling = await linkState(selection.siblingPath, source);
    const dependenciesReady = await Promise.all([
      exists(join(source, 'node_modules', 'zod', 'package.json')),
      exists(join(source, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')),
    ]).then(values => values.every(Boolean));
    const runnerReady = await exists(join(source, 'src', 'local-pr.js'));
    return { ...selection, kefaniaPath: source, linkState: sibling, dependenciesReady, runnerReady,
      ready: sibling === 'ready' && dependenciesReady && runnerReady };
  }

  async function apply(input, { update = false } = {}) {
    const current = await inspect(input);
    if (current.linkState === 'conflict')
      throw new Error('The sibling kefania path is already occupied by a different checkout or symlink. Inspect it manually; nothing was overwritten.');
    if (!current.runnerReady) throw new Error('This Kefania checkout is missing src/local-pr.js.');
    if (update) {
      const branch = await command('git', ['-C', current.kefaniaPath, 'branch', '--show-current']);
      if (branch.trim() !== 'main') throw new Error('Update requires the Kefania checkout to be on main.');
      const changes = await command('git', ['-C', current.kefaniaPath, 'status', '--porcelain', '--untracked-files=no']);
      if (changes.trim()) throw new Error('Kefania has uncommitted tracked changes; update it manually before continuing.');
      const origin = await command('git', ['-C', current.kefaniaPath, 'remote', 'get-url', 'origin']);
      if (githubRemote(origin) !== 'pony-factor/kefania') throw new Error('Kefania origin is not pony-factor/kefania; update it manually.');
      await command('git', ['-C', current.kefaniaPath, 'pull', '--ff-only', 'origin', 'main'], { timeout: 120000 });
    }
    if (update || !current.dependenciesReady) {
      await command('npm', ['ci', '--ignore-scripts'], { cwd: current.kefaniaPath, timeout: 180000 });
    }
    if (current.linkState === 'missing') await symlink(current.kefaniaPath, current.siblingPath, 'dir');
    return inspect(input);
  }

  return { check: inspect, repair: input => apply(input), update: input => apply(input, { update: true }) };
}
