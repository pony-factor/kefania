# Kefania (Codex Drafter)

Kefania provides the canonical pull-request drafting rules in [`PULL_REQUEST.md`](PULL_REQUEST.md) and a local Model Context Protocol (MCP) server for diff-grounded GitHub pull-request publishing.

## Sweetiebot: New PR workflow

Keep this checkout beside the repository whose pull request you want to draft. Select a working branch other than the target base branch; Sweetiebot's **New PR** button is disabled on the base. The button opens ChatGPT and submits a drafting prompt containing the selected repository, head, base, and these rules.

The branch must already be published and contain committed changes. Opening the drafting chat does **not** stage, commit, push, or merge anything. A working authenticated GitHub connection is needed for publishing.

The drafting chat prefers Kafania's configured `github_create_pull_request` action. When that connection is unavailable, the rules allow an authenticated GitHub publishing tool as a fallback, after checking the exact comparison and avoiding duplicate open PRs. The publishing path must add the centered description attribution once. Any supplied conversation provenance belongs in a separate PR comment.

## Install and local MCP

Install Node.js 20 or newer and the GitHub CLI, then authenticate `gh` for the repositories you intend to modify.

```sh
npm ci
gh auth login
npm start
```

`npm start` runs the stdio MCP server. Configure your MCP client to launch it from this checkout. GitHub authentication comes from `gh`; do not put credentials in tool arguments or commit them to the repository. Optionally set `KEFANIA_ALLOWED_REPOSITORIES` to a comma-separated allowlist of `owner/repo` values.

The server offers `kefania_status`, `kefania_drafting_rules`, `github_get_pull_request_context`, `github_create_pull_request`, and `github_comment_pull_request_source`. Read the branch context before publication, including its head SHA. The creation action reuses an existing matching PR, protects against a changed head, and does not make Git commits.

## HTTP transport

To run the locally bound HTTP endpoint, configure a strong MCP bearer token and an explicit repository allowlist:

```sh
export KEFANIA_MCP_TOKEN='at-least-32-random-characters-here'
export KEFANIA_ALLOWED_REPOSITORIES='pony-factor/kefania'
npm run start:http
```

By default the endpoint listens on `127.0.0.1:8765/mcp`. Exposing it beyond loopback also requires `KEFANIA_HOST` and `KEFANIA_ALLOWED_HOSTS`; terminate TLS through a trusted proxy and restrict access to authorized clients. `KEFANIA_MCP_TOKEN` is separate from GitHub authentication.

## Drafting and provenance

`PULL_REQUEST.md` is the source of truth for titles, descriptions, related history, and attribution. The MCP server exposes it through `kefania_drafting_rules` and alongside branch evidence from `github_get_pull_request_context`.

If a caller supplies a real ChatGPT or Codex conversation UUID and link, Kafania records it in a deduplicated source comment. Do not invent a source UUID or link. The current server does **not** preserve original prompts in the GitHub edit history; fallback publication likewise cannot claim that behavior.

`github_create_pull_request` adds the designated description image once. Its attribution applies to the PR description, not the underlying repository changes.

## Development checks

```sh
npm test
```

The project does not include GitHub merging tools; handle merges separately through authenticated GitHub tools or the GitHub interface.
