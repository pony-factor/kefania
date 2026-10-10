# Kefania PR handoff

Continue the Kefania PR integration on **hard-hat** in this repository. The user wants Sweetiebot's **New PR** button to use the conversation where the work happened, research useful sources and backreferences, and publish the resulting description through Kefania as the GitHub App bot. Reuse the finished description; do not start another model run just to publish it.

## Repository and branch

- Primary repository: `pony-factor/kefania`.
- Primary branch at handoff: `hard-hat`.
- Local publisher checkout: `/Users/windsor/GitHub/pony-factor/kefania`.
- Companion button repository: `pony-factor/sweetiebot-SCM`, locally on `rubinstein` when checked.
- Companion PR: https://github.com/pony-factor/sweetiebot-SCM/pull/215
- Existing unrelated modifications in the companion checkout at handoff: `scripts/github_pr.py` and `tests/test_github_pr.py`. Preserve them and recheck both working trees before editing.

Kefania owns the drafting and publishing runner; Sweetiebot owns the New PR button. Runner changes belong here on `hard-hat`, and button changes belong in the companion repository. Installing or activating branch changes is a separate step from editing source. Do not assume a cloud task can reach the sibling checkout or this Mac's runtime.

## Current implementation and observed gap

`assets/workbench/picker.js` in the companion Sweetiebot source tries `sweetiebot.openPullRequestChat` first. It calls `sweetiebot.createLocalPullRequest` only when the browser is unavailable before launch. A failed or unfinished browser chat must not start a second drafter.

Sweetiebot's `efs/pull_request.js` obtains verified published-branch evidence through `efs/kefania_runner.js`, bounds the patch text to 30,000 characters, and opens ChatGPT in VS Code's Integrated Browser. ChatGPT receives the canonical Kefania rules and returns the finished title/body through a one-time local publication link. The callback retains the verified head SHA, expires after one hour, checks the active branch, is consumed before publishing, and forces GitHub App authentication. Keep these safeguards.

The installed picker inspected after PR #215 still called `sweetiebot.createLocalPullRequest` directly. The running UI also described local Kefania/Codex drafting. The browser-first branch source was therefore not active in the observed installed copy. PR #215 was created by `codex-pony[bot]`, with no conversation provenance comment. There is no saved evidence proving which local model drafted it; do not present that as confirmed browser usage.

## Conversation context to carry forward

The intent of this work is:

1. Draft in the existing ChatGPT/Codex task when possible, preserving the reasons, requirements, and decisions discussed there.
2. Research relevant repository history and primary sources, adding verified backreferences when useful.
3. Publish the already completed draft with Kefania as the bot, choosing the installation for the target repository automatically.
4. Use the Codex CLI only as the local drafting fallback, with its latest recommended model available to the account and medium reasoning. Local Ollama follows if CLI drafting fails, using the model and options saved in Kefania's setup UI.

The local fallback currently forwards conversation identity metadata when available, but drops conversation text. `readCodexConversation` in `efs/pull_request.js` can obtain a window-local snapshot through `sweetiebot.readCodexConversation`, bounding text to the last 6,000 characters. The browser path currently attempts this only when an explicit source is absent, and labels captured text as context for an optional intent summary. That is insufficient for reliably carrying the requirements behind this change.

Make the handoff explicit: include relevant conversation intent and decisions in the drafting prompt even when source metadata was already supplied. Treat conversation text as context, while the verified branch comparison remains evidence of implemented changes. A source URL is provenance, not a substitute for the conversation text. Handle unavailable or truncated snapshots honestly, and avoid forwarding credentials or unrelated conversations. Inspect `assets/codex/codex-context-host.js` and `assets/codex/codex-context-webview.js` before changing snapshot behavior.

## Codex Web support

Codex Web can draft from its own task conversation and pass finished title/body to a publisher. It does not automatically inherit this local conversation; this handoff supplies its relevant intent.

There is no verified, documented extension hook here that replaces Codex Web's built-in Create PR button. Implement an explicit Kefania command or tool rather than claiming that button is intercepted. Cloud tasks have isolated workspaces and cannot directly use this Mac's Keychain or localhost service. A cloud publishing path needs a reachable authenticated publisher or a suitable GitHub-hosted execution path. Choose and document the actual mechanism before deployment; do not expose or copy the App private key into source, prompts, logs, or task-visible files. Cloud access and authentication are not configured by this handoff.

[Official cloud environment documentation](https://learn.chatgpt.com/docs/environments/cloud-environments)

## Activation and verification

Check source, installer payload, installed companion extension, patched workbench, and the running VS Code window separately. An updater can restore a different payload; inspect `scripts/update.py` and `scripts/repair.py`, including `installed_sources_match`, `repair.lock`, and `installed-revision`. Do not assume copying a file activates it. Preserve active tasks and queued messages before any reload.

Verify the actual New PR interaction in VS Code: conversation context reaches the browser prompt, research happens in that chat, the finished draft reaches Kefania unchanged, and bot publication does not invoke CLI or Ollama again. Test fallback only for browser unavailability before launch. Check changed-head rejection, callback expiration/reuse, duplicate prevention, and publication failures without retrying another drafter. Do not create a duplicate of PR #215 merely to prove the button works. Report any live checks that remain unverified.

Keep the requested compact progress notice: icon **🫧**, text **Creating new pull request with Kefania instructions**.

Never automatically stage or commit. Never commit without an explicit request. The user's `cp` means commit and push without running checks. Use squash merge by default when a merge is explicitly requested. Preserve unrelated work and never read or expose secret-bearing files.
