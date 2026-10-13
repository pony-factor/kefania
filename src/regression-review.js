import { secretPath } from './safe-paths.js';

const MAX_REPORTED = 12;
const meaningful = value => value.trim().length >= 12;

// Match actual removed/added lines, never just file-level overlap. Deliberately
// conservative: this surfaces evidence for people, not a proof of bad intent.
function lines(patch, sign) {
  if (typeof patch !== 'string') return null;
  const counts = new Map();
  for (const line of patch.split('\n')) {
    if (!line.startsWith(sign) || line.startsWith(sign.repeat(3))) continue;
    const value = line.slice(1);
    if (!meaningful(value)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function sharedCount(left, right) {
  if (!left || !right) return 0;
  let count = 0;
  for (const [line, times] of left) count += Math.min(times, right.get(line) || 0);
  return count;
}

export function detectRegressions(newerMain, mergeResult) {
  if (!Array.isArray(newerMain?.files) || !Array.isArray(mergeResult?.files)
      || newerMain.files.length >= 300 || mergeResult.files.length >= 300) {
    return { status: 'unavailable', reason: 'GitHub did not provide a complete changed-file comparison.' };
  }
  const changes = new Map(newerMain.files
    .filter(file => !secretPath(file.filename) && !secretPath(file.previous_filename || ''))
    .map(file => [file.filename, file]));
  const findings = [];
  let incomplete = false;
  for (const merged of mergeResult.files) {
    if (secretPath(merged.filename) || secretPath(merged.previous_filename || '')) continue;
    const previous = changes.get(merged.filename) || changes.get(merged.previous_filename);
    if (!previous) continue;
    const inserted = lines(previous.patch, '+');
    const removed = lines(previous.patch, '-');
    const candidateRemovals = lines(merged.patch, '-');
    const candidateAdditions = lines(merged.patch, '+');
    if (!inserted || !removed || !candidateRemovals || !candidateAdditions) {
      incomplete = true;
      continue;
    }
    const lost = sharedCount(inserted, candidateRemovals);
    const restored = sharedCount(removed, candidateAdditions);
    if (lost || restored) findings.push({ path: merged.filename, lost, restored });
  }
  if (incomplete) return { status: 'unavailable',
    reason: 'GitHub omitted a patch for a file changed on both sides; the review cannot exclude regressions.',
    findings: findings.slice(0, MAX_REPORTED) };
  findings.sort((a, b) => (b.lost + b.restored) - (a.lost + a.restored));
  return { status: findings.length ? 'risks' : 'clear',
    findings: findings.slice(0, MAX_REPORTED), omitted: Math.max(0, findings.length - MAX_REPORTED) };
}

// GitHub provides a temporary test-merge commit for mergeable PRs. Verify its
// exact parents before calling its tree the candidate result. A changed head,
// outdated base, conflicts, or missing test merge must NOT produce a clean bill.
export async function inspectPublishedMerge({ request, root, pr, headSha, baseSha, mergeBaseSha }) {
  if (mergeBaseSha === baseSha) return { status: 'clear', findings: [], omitted: 0 };
  try {
    const details = await request(root + '/pulls/' + pr.number);
    if (details.head?.sha !== headSha || details.base?.sha !== baseSha) {
      return { status: 'unavailable', reason: 'The PR head or base moved during review.' };
    }
    const mergeSha = details.merge_commit_sha;
    if (!/^[a-f0-9]{40}$/i.test(mergeSha || '')) {
      return { status: 'unavailable', reason: 'GitHub has not supplied a test-merge commit.' };
    }
    const commit = await request(root + '/commits/' + mergeSha);
    const parents = commit.parents || [];
    if (parents.length !== 2 || parents[0].sha !== baseSha || parents[1].sha !== headSha) {
      return { status: 'unavailable', reason: 'The proposed merge tree could not be verified against both branch heads.' };
    }
    const [newerMain, mergeResult] = await Promise.all([
      request(root + '/compare/' + mergeBaseSha + '...' + baseSha),
      request(root + '/compare/' + baseSha + '...' + mergeSha),
    ]);
    return { ...detectRegressions(newerMain, mergeResult), mergeSha };
  } catch {
    return { status: 'unavailable', reason: 'GitHub could not complete the merge comparison.' };
  }
}

const quotePath = value => String(value).replace(/[\r\n]/g, ' ').replace(/\x60/g, "'");

export function formatRegressionReview(review, { headSha, baseSha, mergeBaseSha, root, marker }) {
  const repository = root.replace(/^repos\//, '');
  const baseUrl = 'https://github.com/' + repository;
  const intro = [
    marker,
    '### Kefania: merge regression review',
    '',
    'This is a **non-blocking, automated review**. Discuss intentional replacements or removals in the PR conversation; this comment does not approve, reject, or merge the PR.',
    '',
  ];
  if (review.status === 'unavailable') {
    intro.push('**Review incomplete:** ' + review.reason,
      'A verified resulting merge tree was not available. Check the current base and the complete proposed merge before merging.');
  } else {
    intro.push('**Potential reversions of changes accepted on the base branch since this branch diverged:**',
      'The following lines appear in the newer base changes and are reversed in GitHub\'s verified test-merge result. Matches warrant human review; they are not necessarily mistakes.',
      '');
    for (const item of review.findings || []) {
      const details = [];
      if (item.lost) details.push(item.lost + ' newly added line(s) removed');
      if (item.restored) details.push(item.restored + ' recently deleted line(s) restored');
      intro.push('- \x60' + quotePath(item.path) + '\x60 — ' + details.join('; '));
    }
    if (review.omitted) intro.push('- ...and ' + review.omitted + ' more affected file(s).');
  }
  intro.push('', 'Evidence: [newer base changes](' + baseUrl + '/compare/' + mergeBaseSha + '...' + baseSha + ')' +
    (review.mergeSha ? ' · [tested merge result](' + baseUrl + '/compare/' + baseSha + '...' + review.mergeSha + ')' : ''),
    'Head checked: \x60' + headSha + '\x60. Re-run Kafania after new commits to review that revision.');
  return intro.join('\n');
}
