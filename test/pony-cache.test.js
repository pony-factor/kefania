import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPonyCache, writePonyCache, removePonyCache, ponyCacheAction,
  ponyCacheKey, PONY_CACHE_LIFETIME_MS, MAX_PONY_PROFILE_BYTES,
} from '../src/pony-cache.js';

test('reuses a character across PRs without blending packs or aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kefania-pony-'));
  try {
    const pony = { packId: 'g4-mares', slug: 'magical-ponycelena', canonicalSlug: 'celena', source: 'https://example.org/celena' };
    const canonical = { ...pony, slug: 'celena' };
    const profile = 'Celena, with verified source attribution.';
    assert.deepEqual(await readPonyCache(pony, { directory }), { hit: false });
    assert.deepEqual(await ponyCacheAction({ action: 'put', pony, profile }, { directory }), { stored: true });
    assert.equal((await readPonyCache(canonical, { directory })).profile, profile);
    assert.equal(ponyCacheKey(pony), ponyCacheKey(canonical));
    assert.deepEqual(await readPonyCache({ ...canonical, packId: 'g5-mares' }, { directory }), { hit: false });
    assert.deepEqual(await readPonyCache({ ...canonical, source: 'https://example.org/updated' }, { directory }), { hit: false });
    const filenames = await readdir(directory);
    assert.equal(filenames.length, 1);
    assert.equal((await stat(join(directory, filenames[0]))).mode & 0o777, 0o600);
    assert.deepEqual(await removePonyCache(pony, { directory }), { removed: true });
    assert.deepEqual(await readPonyCache(canonical, { directory }), { hit: false });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('expires entries and treats corrupted or wrong-version data as misses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kefania-pony-'));
  const pony = { packId: 'g4-stallions', slug: 'sunburst' };
  try {
    await writePonyCache(pony, 'A sourced profile', { directory, now: () => 1000 });
    assert.equal((await readPonyCache(pony, { directory, now: () => 1000 + PONY_CACHE_LIFETIME_MS - 1 })).hit, true);
    assert.deepEqual(await readPonyCache(pony, { directory, now: () => 1000 + PONY_CACHE_LIFETIME_MS }), { hit: false });
    assert.deepEqual(await readPonyCache(pony, { directory, now: () => 999 }), { hit: false });
    const file = join(directory, ponyCacheKey(pony) + '.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...saved, version: 999 }));
    assert.deepEqual(await readPonyCache(pony, { directory, now: () => 1001 }), { hit: false });
    await writeFile(file, '{invalid json');
    assert.deepEqual(await readPonyCache(pony, { directory }), { hit: false });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects invalid identities, empty profiles and oversized results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kefania-pony-'));
  try {
    assert.throws(() => ponyCacheKey({ packId: 'g4', slug: '../../secrets' }), /Invalid pony/);
    assert.throws(() => ponyCacheKey({ packId: 'g4' }), /Invalid pony/);
    const pony = { packId: 'g4-mares', slug: 'luna' };
    await assert.rejects(writePonyCache(pony, '  ', { directory }), /Invalid pony profile/);
    await assert.rejects(writePonyCache(pony, '🦄'.repeat(Math.ceil(MAX_PONY_PROFILE_BYTES / 4) + 1), { directory }), /Invalid pony profile/);
    assert.deepEqual(await ponyCacheAction({ action: 'get', pony }, { directory }), { hit: false });
    assert.equal((await readdir(directory)).length, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
