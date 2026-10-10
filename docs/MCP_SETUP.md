# Set up Kafania MCP for Sweetiebot

Kafania is the `codex-drafter` MCP server used by Sweetiebot's **Create new pull request** button. It supplies `github_get_pull_request_context` (a read-only, branch-aware comparison) and `github_create_pull_request` (GitHub publication). **Registering a local server with VS Code does not connect it to a ChatGPT conversation in VS Code's Integrated Browser.** These are separate clients with separate tool connections.

This document is the connection/setup guide. [`PULL_REQUEST.md`](../PULL_REQUEST.md) remains the canonical *drafting and fallback policy*. For the implementation, authentication requirements, and full tool list, see the [README](../README.md).

## Choose where the assistant runs

| Assistant/client | Transport | What you must connect |
| --- | --- | --- |
| VS Code MCP-aware client | Local stdio | Register the `codex-drafter` process in that client's MCP configuration |
| ChatGPT web / Sweetiebot's Integrated Browser | ChatGPT plugin or supported remote MCP app connection | Connect **Kafania itself** using Secure MCP Tunnel for a local service when available, or a reachable HTTPS MCP endpoint with compatible authentication |
| ChatGPT Desktop with a supported local-plugin configuration | Local plugin MCP integration | Install/configure the plugin and authorize its Kafania app on that desktop client; a VS Code registration alone is still insufficient |

A prompt *naming* `codex-drafter` does not install or connect it. An authenticated GitHub plugin is also **not** automatically the Kafania MCP server; it may be used only as the fallback described in `PULL_REQUEST.md`.

## 1. Prepare Kafania on your Mac

Requirements: Node.js 20+, GitHub CLI (`gh`), and GitHub repository permission to read comparisons and create PRs.

```sh
git clone https://github.com/pony-factor/kefania.git
cd kefania
npm ci --ignore-scripts
gh auth login
gh auth status
```

If GitHub CLI is already authenticated, `gh auth login` can be skipped. Kafania uses the existing `gh` session; **do not paste a GitHub token into `.vscode/mcp.json`**. Head and base must be published branches in the selected repository; it cannot turn local unpushed edits into a PR.

## Browser-based GitHub setup

Run `npm run setup:web` after installing dependencies, then open **http://127.0.0.1:8766/**. This is a local interface for GitHub user authorization, picking repositories, and choosing PR writing style. It does **not** expose MCP tools to the ChatGPT browser by itself.

To enable browser authorization, the **codex-pony** GitHub App administrator must enable **Device Flow** and grant Contents (read), Pull requests and Issues (read/write), and Metadata (read), with the app installed on the desired repositories. Enter the **public Client ID** in the page (no private key required). Click Connect GitHub, open `https://github.com/login/device` through the provided button, and enter the one-time code. GitHub user authorization creates user-attributed PRs. Existing installation credentials create bot-attributed PRs, and `gh auth login` remains a fallback.

Saved style choices automatically feed into the MCP drafting resource/prompt and the local Codex runner. The page supports a dry-run **Preview description** and separately confirmed **Publish ready-for-review PR**. It does not stage, push, merge, or deploy code. On macOS user tokens are stored in Keychain, while writing preferences are stored locally without credentials. On other platforms user auth is temporary per-process; use authenticated `gh` for a persistent fallback. See the [README](../README.md#browser-setup-and-github-identity) for details.

## 2. Connect a VS Code MCP client (local stdio)

Opening the Kafania workspace in VS Code uses its checked-in `[.vscode/mcp.json](../.vscode/mcp.json)` registration. For other workspaces, register a user-level server, replacing the path below with the actual absolute path on your Mac:

```sh
code --add-mcp '{"name":"codex-drafter","command":"node","args":["/absolute/path/to/kefania/src/index.js"]}'
```

Your MCP-capable VS Code client can then start Kafania automatically. `npm start` is an alternative **stdio** launch method for an MCP client: it is not an HTTP server, and running it in a terminal does not publish an endpoint that ChatGPT can reach.

In the MCP client, confirm `kefania_status` is listed and returns GitHub access. Then call `github_get_pull_request_context` with an actual `owner`, `repo`, `head`, and `base` before any write. If the tools are absent, inspect the VS Code MCP registration and server logs rather than assuming that a browser tab can discover the server.

## 3. Connect ChatGPT (including Sweetiebot's browser)

Sweetiebot opens ChatGPT's web interface through VS Code's Integrated Browser. That page uses **ChatGPT's** available plugin/app connections, not the VS Code editor's stdio MCP registration.

For a Kafania server running only on your Mac:

1. Start or configure Kafania with its supported local HTTP transport (below). Keep it bound to loopback.
2. In ChatGPT **Plugins**, configure a Kafania plugin/app using **Secure MCP Tunnel** if this feature is available to your account and client. Follow the platform's on-screen tunnel connection and authorization steps; this repository does not create or install a ChatGPT plugin automatically.
3. In the **same ChatGPT conversation** in which the Sweetiebot PR prompt appears, confirm the actual Kafania tools are exposed. The tool names are `kefania_status`, `github_get_pull_request_context`, and `github_create_pull_request`. Do not infer availability from a text prompt or a VS Code MCP configuration.
4. Request the read-only `kefania_status` and branch context first. Publish only once the correct branch comparison has been returned.

For a hosted or reverse-proxied deployment, ChatGPT needs a **reachable HTTPS MCP connection and compatible authentication**. Kafania's built-in HTTP server enforces a bearer token but **does not implement OAuth authorization**. If the selected ChatGPT connection requires OAuth, provide that through a supported authenticated gateway/proxy; do not expose an unauthenticated tunnel or claim raw bearer-only Kafania is directly compatible with every ChatGPT account. Availability and permissions can vary by plan or workspace.

Official platform guidance: [Plugins in ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt) and [Developer mode / MCP apps (including Secure MCP Tunnel)](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

### Run Kafania's HTTP transport locally

From the Kafania checkout, in the process environment (not committed files):

```sh
export KEFANIA_MCP_TOKEN="$(openssl rand -hex 32)"
export KEFANIA_ALLOWED_REPOSITORIES="pony-factor/sweetiebot-SCM"
npm run start:http
```

The default listener is `127.0.0.1:8765`; the MCP endpoint is `http://127.0.0.1:8765/mcp`. For basic **listener** health only:

```sh
curl --fail http://127.0.0.1:8765/health
```

`/health` does **not** verify GitHub authentication or ChatGPT connectivity. The MCP endpoint requires `Authorization: Bearer <KEFANIA_MCP_TOKEN>`; the bearer secret is **not** the GitHub credential. The supported tunnel or gateway must supply it without exposing it to browsers, GitHub, committed configuration, or PR prompts.

For remote deployments, restrict `KEFANIA_ALLOWED_REPOSITORIES` to authorized `owner/repo` entries and set `KEFANIA_ALLOWED_HOSTS` when listening on a non-local interface. Use TLS and a trustworthy gateway. Do not expose the raw HTTP listener publicly or disable its authentication or host/origin validation.

## 4. Publishing and fallback

- Kafania first reads `github_get_pull_request_context` for the exact same-repository head/base; review any incomplete/truncated patch flags and use its `headSha` as `expectedHeadSha` when calling `github_create_pull_request`. This guards against publishing against a changed branch.
- The Kafania publishing tool reuses an existing open head/base PR. It publishes the description without an automatic footer image and records conversation provenance separately when provided. Do not stage, commit, or push as part of **drafting** a PR.
- If Kafania is **not connected in the current ChatGPT conversation**, follow the canonical [publishing fallback](../PULL_REQUEST.md#publishing): use an available *authenticated* GitHub tool, read the comparison, check for an existing open PR, without adding an attribution image. Do not claim the GitHub fallback was a Kafania MCP write. If no authenticated publisher is available, report the missing connection and provide a draft.
- Sweetiebot may emit older stricter instructions to **stop** when its configured Kafania server is unavailable. This is prompt text generated by the Sweetiebot repository and does not establish that Kafania is connected. Keep the actual publisher and any fallback explicit.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex-drafter` appears in VS Code, absent in ChatGPT | Expected unless you independently connected it to ChatGPT. Configure the ChatGPT plugin/app and tunnel or compatible hosted endpoint. |
| ChatGPT has GitHub tools but not Kafania tools | You have a possible **fallback**, not the configured Kafania MCP writer. Follow `PULL_REQUEST.md`. |
| HTTP `401` | Check the bearer secret on the actual MCP request and configured gateway; do not post it in a PR. |
| HTTP `403` | Browser-origin requests are intentionally rejected; use the server-side MCP client/tunnel, not page JavaScript. |
| `/health` responds but publishing fails | Run read-only `kefania_status` to inspect GitHub permissions and allowed repository scope. |
| PR already exists or the head changed | Re-read context; reuse the existing open PR or supply a fresh `expectedHeadSha`. Never create a duplicate PR blindly. |

Kafania never automatically merges pull requests. Its MCP tool being installed or described in the prompt is not evidence of a successful publication: verify the tool result and the GitHub PR URL.
