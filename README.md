# Codex Drafter

A small Model Context Protocol server that gives Codex and other MCP clients a controlled way to open GitHub issues and pull requests using a consistent personal publishing style.

The client supplies the actual issue or PR content. Codex Drafter owns the GitHub write step and the presentation rules that should always be applied.

## What it does

- Creates GitHub issues.
- Creates pull requests from an existing branch.
- Records the original user prompt in the issue or PR edit history before replacing it with the final drafted message.
- Defaults pull requests to draft.
- Appends the Codex authorship footer to PR descriptions automatically.
- Supports local stdio MCP clients and a bearer-protected Streamable HTTP endpoint for remote clients.

## Install

```sh
npm install
```

## Local stdio

```sh
export GITHUB_TOKEN='...'
export GITHUB_DEFAULT_OWNER='windsorUwU'
npm run stdio
```

A local MCP client can launch that command as a child process. Nothing needs to be exposed to the internet.

## Local HTTP

```sh
export GITHUB_TOKEN='...'
export GITHUB_DEFAULT_OWNER='windsorUwU'
npm start
```

By default the server listens only on `127.0.0.1:8787`:

- MCP: `http://127.0.0.1:8787/mcp`
- health: `http://127.0.0.1:8787/health`

## Prompt provenance

Both write tools take two separate text inputs:

- `prompt` is the user's original input. Codex Drafter publishes this value verbatim, without trimming or rewriting it, immediately after an `## AI Prompt` heading.
- `body` is the final issue or pull request message.

The server creates the GitHub item with the prompt body first, then edits that same item to the final message. The current issue or PR stays clean while GitHub's edit history preserves the exact prompt that led to it.

The initial body has this shape:

```md
## AI Prompt

<user input verbatim>
```

## Canonical rules and conversation provenance

`PULL_REQUEST.md` contains the canonical drafting rules. The current MCP server exposes these through `kefania_drafting_rules` and includes them in `github_get_pull_request_context` so clients can ground the title and description in the actual branch diff.

`github_create_pull_request` and `github_comment_pull_request_source` accept optional, caller-supplied ChatGPT or Codex conversation metadata. When provided, the server adds a separate, deduplicated provenance comment; it never fabricates a conversation UUID or URL.

## PR footer

Every PR created through `github_create_pull_request` gets the authorship disclosure appended at the very bottom of the final body by the server itself.

Set the public banner image and click target with:

```sh
export CODEX_BANNER_URL='https://raw.githubusercontent.com/windsorUwU/codex-drafter/main/assets/codex-banner.png'
export CODEX_BANNER_LINK='https://youtu.be/DkUEHMfQw-I'
```

If `CODEX_BANNER_URL` is not set, the footer falls back to a linked text credit instead of inserting a broken image. The intended canonical asset is the generated dark Codex pony banner in `assets/codex-banner.png` once that binary is committed.

## Remote connection

Codex Web or another cloud MCP client needs a remotely reachable HTTPS endpoint rather than a process running only on your Mac.

For a remote deployment, explicitly configure:

```sh
export GITHUB_TOKEN='...'
export GITHUB_DEFAULT_OWNER='windsorUwU'
export MCP_HOST='0.0.0.0'
export MCP_PORT='8787'
export MCP_PUBLIC_HOSTNAME='mcp.example.com'
export MCP_BEARER_TOKEN='a-long-random-secret'
npm start
```

Non-loopback startup fails closed unless both `MCP_PUBLIC_HOSTNAME` and `MCP_BEARER_TOKEN` are present. Terminate TLS at a trusted reverse proxy or hosting platform and connect the MCP client to `https://mcp.example.com/mcp`.

## GitHub permissions

Keep `GITHUB_TOKEN` in the process environment or a secret manager. For a fine-grained token, grant only the repositories this service should modify. The initial tools need Issues write permission for issue creation and Pull requests write permission for PR creation.

## Current tools

- `github_create_issue`
- `github_create_pull_request`

The first version intentionally does not create branches, write repository files, merge PRs, modify reviews, or manage GitHub App/OAuth installation tokens. Those can be added as separate tools later.
