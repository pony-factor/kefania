# Kefania MCP

Kefania supplies the GitHub tools requested by Sweetiebot's New PR button. The MCP server identifies itself as `codex-drafter`. It runs locally over stdio or over authenticated Streamable HTTP.

The drafting model writes the title and description from repository evidence. Kefania reads the published branch comparison, publishes the PR, applies the description image from `PULL_REQUEST.md`, and records supplied conversation provenance in a separate comment. It never stages, commits, pushes, or merges repository changes.

## Local setup

For Sweetiebot's PR button, the local runner uses your existing Codex ChatGPT login to draft, then publishes as the `codex-pony` GitHub App. It requires no OpenAI API key, HTTP listener, or tunnel. Install the Codex CLI and sign in with `codex login`; configure the GitHub App environment below. Keep this checkout beside the repository using Sweetiebot and install its dependencies with `npm ci --ignore-scripts`.

The button passes the repository, head, base, and available conversation source to `src/local-pr.js`. The runner reads the published comparison through the GitHub App API, withholds secret-bearing patches, and asks a read-only Codex process for structured title/body text. Kefania then publishes a draft PR using the verified head SHA and existing duplicate and provenance handling. It never stages, commits, or pushes.

To generate text without publishing, send a JSON request on stdin:

```sh
printf '%s\n' '{"repository":"owner/repo","head":"branch","base":"main","draftOnly":true}' | npm run --silent pr:local
```

Omit `draftOnly` to draft and publish. The runner forces ChatGPT login and removes API-key environment variables from the drafting process. Codex runs locally but inference uses your ChatGPT plan. See the [Codex authentication documentation](https://learn.chatgpt.com/docs/auth).

The MCP transports below remain available for clients that already use them.

Install Node.js 20 or newer, configure the app environment, then run:

```sh
npm ci --ignore-scripts
npm start
```

`npm start` speaks MCP over stdin/stdout; it does not open a web page. The included `.vscode/mcp.json` registers the local server when this repository is open in VS Code. To make it available in other VS Code workspaces, use the supported `code --add-mcp` command with an absolute entrypoint path:

```sh
code --add-mcp '{"name":"codex-drafter","command":"node","args":["/absolute/path/to/kefania/src/index.js"]}'
```

### GitHub App identity

Kefania defaults to the `codex-pony` app installation for every GitHub request, including PR creation and provenance comments. Supply these variables securely through the process environment for both the MCP server and the local runner:

- `KEFANIA_GITHUB_APP_ID`: the app ID or client ID from the app settings.
- `KEFANIA_GITHUB_INSTALLATION_ID`: the installation ID for the account owning the repositories.
- `KEFANIA_GITHUB_PRIVATE_KEY`: the PEM private key, with actual newlines.

Install the app on the target repositories with Contents read access and Pull requests and Issues write access. Kefania verifies the app slug, exchanges a signed JWT for an installation token, and refreshes it before expiry. It never reads credential files or logs credentials. Missing or invalid app configuration fails without falling back to a personal account. `kefania_status` reports the app bot identity and verifies installation access.

For an intentional personal-account setup, set `KEFANIA_GITHUB_AUTH=cli` and sign in with `gh auth login`. This explicitly restores the previous GitHub CLI authentication behavior; `GH_TOKEN` or `GITHUB_TOKEN` apply only in this mode.

## Tools

| Tool | Purpose |
| --- | --- |
| `kefania_status` | Check GitHub access and repository scope without writing. |
| `kefania_drafting_rules` | Read the canonical instructions. |
| `github_get_pull_request_context` | Read the published branch comparison, return its head SHA and drafting rules. |
| `github_create_pull_request` | Create a draft PR, or return the existing open PR for the same head/base. |
| `github_comment_pull_request_source` | Record supplied originating conversation metadata once on an open PR. |
| `github_create_issue` | Preserve a supplied prompt in edit history and publish the final issue text. |

The server also exposes `kefania://pull-request/rules` and the `draft_pull_request` prompt.

Read the comparison before creating a PR and pass its `headSha` as `expectedHeadSha`. Creation rejects a changed head or a branch with no committed difference from the base. This version supports branches in the selected repository. Comparisons flag omitted, unavailable, or truncated patches; do not describe unseen changes as reviewed.

PRs default to draft. Set `draft: false` to request a ready-for-review PR. The description image appears exactly once. The optional `prompt` argument is published verbatim under `## AI Prompt` and then replaced by the final description, preserving the original in GitHub edit history. Only supply text the user authorized for publication; source-conversation metadata belongs in the separate `source` argument. Issue creation requires `prompt`.

When description finalization or provenance recording fails after creation, the result retains the created PR or issue URL and identifies the failed step. Do not repeat creation to repair that step.

## HTTP and remote clients

Set these environment variables through the hosting platform or process environment:

- `KEFANIA_MCP_TOKEN`: a separate bearer secret of at least 32 characters; never the GitHub token.
- `KEFANIA_ALLOWED_REPOSITORIES`: a comma-separated list of exact `owner/repo` names.
- `KEFANIA_HOST`: defaults to `127.0.0.1`.
- `PORT`: defaults to `8765`.
- `KEFANIA_ALLOWED_HOSTS`: required for a non-local listener; list the hostnames served by the reverse proxy.

Then run `npm run start:http`. The MCP endpoint is `/mcp`; `/health` reports whether the HTTP listener is running. `kefania_status` checks actual GitHub access. MCP requests require `Authorization: Bearer <KEFANIA_MCP_TOKEN>`. HTTP rejects browser-origin requests and validates the Host header. Repository restrictions apply to every read and write.

The prior environment names `MCP_HOST`, `MCP_PORT`, `MCP_BEARER_TOKEN`, and `MCP_PUBLIC_HOSTNAME` remain supported. The Dockerfile includes Node and the GitHub CLI and starts HTTP mode. Provide secrets at runtime, never in the image or repository.

Local VS Code registration makes the server available to VS Code's MCP clients. It does **not** connect ChatGPT inside the Integrated Browser. A browser/cloud client needs a reachable HTTPS endpoint and a compatible authentication connection. The HTTP transport currently supports bearer-authenticated clients; it does not implement an OAuth authorization service. Configure supported authentication at the hosting gateway before connecting ChatGPT. No public endpoint is deployed by this checkout.

## Verification

`npm test` exercises MCP startup and discovery, authenticated HTTP, repository scope, exact prompt preservation, duplicate PR prevention, changed-head rejection, attribution, and provenance failures. GitHub writes in tests use fixtures. Live setup verification can call `kefania_status` and a read-only branch comparison without publishing anything.

Transport implementation follows the [official MCP SDK server guidance](https://ts.sdk.modelcontextprotocol.io/server).
