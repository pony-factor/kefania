# Kefania MCP

Kefania supplies the GitHub tools requested by Sweetiebot's New PR button. The MCP server identifies itself as `codex-drafter`. It runs locally over stdio or over authenticated Streamable HTTP.

The drafting model writes the title and description from repository evidence. Kefania reads the published branch comparison, publishes the PR, publishes the final description without an automatic footer image, and records supplied conversation provenance in a separate comment. It never stages, commits, pushes, or merges repository changes.

## Setup by client

See **[the canonical Kafania MCP setup guide](docs/MCP_SETUP.md)** for VS Code stdio registration, ChatGPT plugins/Secure MCP Tunnel, authenticated HTTP, verification, and troubleshooting. VS Code registration does not make the tools available in a ChatGPT browser conversation.

## Local setup

For Sweetiebot's PR button, the local runner uses your existing Codex ChatGPT login to draft, then publishes using your authorized GitHub user session, the `codex-pony` GitHub App bot, or your existing `gh` login. It requires no OpenAI API key, HTTP listener, or tunnel. Install the Codex CLI and sign in with `codex login`; connect GitHub using the browser setup below. Keep this checkout beside the repository using Sweetiebot and install its dependencies with `npm ci --ignore-scripts`.

The button passes the repository, head, base, and available conversation source to `src/local-pr.js`. The runner reads the published comparison through the GitHub App API, withholds secret-bearing patches, and asks a read-only Codex process for structured title/body text. Kefania then publishes a ready-for-review PR using the verified head SHA and existing duplicate and provenance handling. It never stages, commits, or pushes.

To generate text without publishing, send a JSON request on stdin:

```sh
printf '%s\n' '{"repository":"owner/repo","head":"branch","base":"main","draftOnly":true}' | npm run --silent pr:local
```

Omit `draftOnly` to draft and publish. The runner forces ChatGPT login and removes API-key environment variables from the drafting process. Codex runs locally but inference uses your ChatGPT plan. See the [Codex authentication documentation](https://learn.chatgpt.com/docs/auth).

The MCP transports below remain available for clients that already use them.

Install Node.js 20 or newer. An existing `gh auth login` is sufficient for fallback access; configure the app when ready, then run:

```sh
npm ci --ignore-scripts
npm start
```

`npm start` speaks MCP over stdin/stdout; it does not open a web page. The included `.vscode/mcp.json` registers the local server when this repository is open in VS Code. To make it available in other VS Code workspaces, use the supported `code --add-mcp` command with an absolute entrypoint path:

```sh
code --add-mcp '{"name":"codex-drafter","command":"node","args":["/absolute/path/to/kefania/src/index.js"]}'
```

### Browser setup and GitHub identity

Launch the local setup page:

```sh
npm run setup:web
```

Open **http://127.0.0.1:8766/**. The interface guides you through GitHub authorization, repository selection, PR writing voice and length, editable instructions, and a safe local preview. It serves only on the local loopback address, not as a published website. To use another port set `KEFANIA_SETUP_PORT`.

For the optional user-account flow, an administrator of the **codex-pony** GitHub App must enable **Device Flow** in the app's settings. Enter the app's **public Client ID** (not its numeric App ID) in the page's Developer setup field. The administrator must also grant Contents (read), Pull requests (read/write), Issues (read/write), and Metadata (read) repository permissions, then install the app on the desired repositories. [GitHub's user authorization guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) documents the device flow. The user clicks **Connect GitHub**, opens GitHub's device-authorization page, enters the displayed one-time code, and approves access. Kefania polls for completion within GitHub's rate limits. No private key, client secret, or personal access token is entered in the browser.

GitHub user sessions are stored in **macOS Keychain**, with no token placed in URLs, logs, files, or browser storage. On non-macOS systems, user sessions remain in memory only and must be reauthorized for a new process; use the existing authenticated `gh` CLI fallback for persistent local workflows there. In the local UI, the only persisted file is `~/.config/kefania/preferences.json`, containing **non-secret** style, public app client ID, and chosen repository names.

**Attribution:** A PR published with the authorized **user** session shows that GitHub user as the creator. The installation-token path publishes as `codex-pony[bot]`. A CLI fallback PR is attributed to the active `gh` user. GitHub's own commit authorship is independent of the PR creator. In automatic mode, Kefania chooses the App installation bot first, then the user connection, then `gh`; it selects the identity before any write and never retries a failed write under another identity.

Configure the preferred bot identity on macOS in the setup page's **Set up codex-pony[bot]** section: enter the numeric App ID, select its downloaded RSA private-key PEM file, click **Find installations**, choose the account or organization, and click **Save bot connection**. Kefania validates access before saving credentials in macOS Keychain. The file input is cleared after submission; the key is never returned to the page or saved in browser storage or preferences. Finish within five minutes or select the file again. New local PR runs use the saved bot connection; restart running MCP servers after setup. The terminal command `npm run setup:github` and environment variables `KEFANIA_GITHUB_APP_ID`, `KEFANIA_GITHUB_INSTALLATION_ID`, and `KEFANIA_GITHUB_PRIVATE_KEY` remain available. The optional user connection does not require that key. Set `KEFANIA_GITHUB_AUTH=user` to require human attribution, `app` to require bot attribution, or `cli` for the CLI-only fallback. Keep credentials in your process environment or Keychain, not source or repository files.

The style settings are appended as **supplemental drafting instructions** to the canonical policy and read by **both** `github_get_pull_request_context`/MCP prompt generation and `src/local-pr.js` on every run. They cannot supersede repository-diff evidence or publication safeguards. Preview from the browser uses `draftOnly` and does not create a GitHub PR. The explicit Publish action runs the existing local Codex drafter and publisher.



## Tools

| Tool | Purpose |
| --- | --- |
| `kefania_status` | Check GitHub access and repository scope without writing. |
| `kefania_drafting_rules` | Read the canonical instructions. |
| `github_get_pull_request_context` | Read the published branch comparison, return its head SHA and drafting rules. |
| `github_create_pull_request` | Create a ready-for-review PR, or return the existing open PR for the same head/base. |
| `github_comment_pull_request_source` | Record supplied originating conversation metadata once on an open PR. |
| `github_create_issue` | Preserve a supplied prompt in edit history and publish the final issue text. |

The server also exposes `kefania://pull-request/rules` and the `draft_pull_request` prompt.

Read the comparison before creating a PR and pass its `headSha` as `expectedHeadSha`. Creation rejects a changed head or a branch with no committed difference from the base. This version supports branches in the selected repository. Comparisons flag omitted, unavailable, or truncated patches; do not describe unseen changes as reviewed.

PRs default to ready for review. Set `draft: true` explicitly through the MCP tool to request a draft PR. PR descriptions have no automatic image or footer. The optional `prompt` argument is published verbatim under `## AI Prompt` and then replaced by the final description, preserving the original in GitHub edit history. Only supply text the user authorized for publication; source-conversation metadata belongs in the separate `source` argument. Issue creation requires `prompt`.

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

`npm test` exercises MCP startup and discovery, authenticated HTTP, repository scope, exact prompt preservation, duplicate PR prevention, changed-head rejection, attribution, browser authorization, preferences, and provenance failures. GitHub writes in tests use fixtures. Live setup verification can call `kefania_status` and a read-only branch comparison without publishing anything.

Transport implementation follows the [official MCP SDK server guidance](https://ts.sdk.modelcontextprotocol.io/server).
