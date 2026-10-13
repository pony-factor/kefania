#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Local-only character enrichment. Never put a profile in GitHub PR data.
export const PONY_CACHE_VERSION = 1;
export const MAX_PONY_PROFILE_BYTES = 60000;
export const PONY_CACHE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const allowed = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function ponyCacheDirectory(env = process.env) {
  if (env.KEFANIA_PONY_CACHE_DIR) return env.KEFANIA_PONY_CACHE_DIR;
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'kefania', 'pony-profiles');
}

export function ponyCacheKey(pony) {
  const pack = String(pony?.packId || '').trim().toLowerCase();
  const slug = String(pony?.canonicalSlug || pony?.slug || '').trim().toLowerCase();
  if (!allowed.test(pack) || !allowed.test(slug)) throw new Error('Invalid pony identity.');
  // Pack ID isolates same-name characters; canonicalSlug folds legacy aliases.
  // Catalog source changes invalidate a cached profile.
  const source = typeof pony?.source === 'string' && /^https:\/\//i.test(pony.source)
    ? pony.source.trim() : '';
  return createHash('sha256').update(JSON.stringify([PONY_CACHE_VERSION, pack, slug, source])).digest('hex');
}

function cacheFile(pony, directory) {
  return join(directory, ponyCacheKey(pony) + '.json');
}

export async function readPonyCache(pony, { directory = ponyCacheDirectory(), now = Date.now } = {}) {
  const key = ponyCacheKey(pony);
  try {
    const saved = JSON.parse(await readFile(join(directory, key + '.json'), 'utf8'));
    const age = now() - saved.savedAt;
    if (saved.version !== PONY_CACHE_VERSION || saved.key !== key
        || !Number.isFinite(age) || age < 0 || age >= PONY_CACHE_LIFETIME_MS
        || typeof saved.profile !== 'string' || !saved.profile.trim()
        || Buffer.byteLength(saved.profile, 'utf8') > MAX_PONY_PROFILE_BYTES) return { hit: false };
    return { hit: true, profile: saved.profile, savedAt: saved.savedAt };
  } catch {
    // Missing, malformed, inaccessible, and stale entries fall back to research.
    return { hit: false };
  }
}

export async function writePonyCache(pony, profile, { directory = ponyCacheDirectory(), now = Date.now } = {}) {
  const key = ponyCacheKey(pony);
  if (typeof profile !== 'string' || !profile.trim()
      || Buffer.byteLength(profile, 'utf8') > MAX_PONY_PROFILE_BYTES) throw new Error('Invalid pony profile.');
  const path = cacheFile(pony, directory);
  const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify({
      version: PONY_CACHE_VERSION, key, savedAt: now(), profile,
    }), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
  return { stored: true };
}

export async function removePonyCache(pony, { directory = ponyCacheDirectory() } = {}) {
  await rm(cacheFile(pony, directory), { force: true });
  return { removed: true };
}

export async function ponyCacheAction(input, options = {}) {
  if (!input || typeof input !== 'object' || !input.pony) throw new Error('Missing pony metadata.');
  if (input.action === 'get') return readPonyCache(input.pony, options);
  if (input.action === 'put') return writePonyCache(input.pony, input.profile, options);
  if (input.action === 'remove') return removePonyCache(input.pony, options);
  throw new Error('Unknown pony cache operation.');
}

// A short-lived local process; the cache does not initiate model calls.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input, 'utf8') > 100000) throw new Error('Request too large.');
    }
    console.log(JSON.stringify(await ponyCacheAction(JSON.parse(input))));
  } catch {
    console.error('Local pony cache request failed.');
    process.exitCode = 1;
  }
}
