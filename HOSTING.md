# Hosted Kefania publisher

The hosted service accepts a finished PR title and body through OAuth-protected MCP or HTTP. It never starts a drafting model. GitHub OAuth authorizes the caller; the target repository's codex-pony installation publishes as the bot.

## Deployment

Deploy the included `Dockerfile`, or use Node 20+ with `npm ci --omit=dev --ignore-scripts` and `npm run start:hosted`. Terminate HTTPS at your host, forward the public Host header, and configure its assigned `PORT` (default `8765`).

Set these values in the host configuration. Put credentials in its secret manager, never in Git, build arguments, command lines, or task prompts.

| Setting | Value |
| --- | --- |
| `KEFANIA_PUBLIC_URL` | HTTPS origin without a path, such as `https://kefania.example.com` |
| `KEFANIA_GITHUB_CLIENT_ID` | codex-pony's public Client ID: `Iv23lisSpJKeF3M3eu30` |
| `KEFANIA_GITHUB_CLIENT_SECRET` | App OAuth client secret |
| `KEFANIA_GITHUB_APP_ID` | Numeric App ID |
| `KEFANIA_GITHUB_PRIVATE_KEY` | App PEM contents, supplied through the secret runtime environment |
| `KEFANIA_ALLOWED_USER_IDS` | Comma-separated numeric GitHub user IDs; obtain yours with `gh api user --jq .id` |
| `KEFANIA_ALLOWED_REPOSITORIES` | Comma-separated exact `owner/repo` names |
| `KEFANIA_OAUTH_REDIRECT_URIS` | Comma-separated exact HTTPS callback URLs supplied by trusted OAuth clients |

Add your public `/oauth/github/callback` URL to codex-pony's authorization callbacks, preserving existing callbacks. Install the App on target repositories with Contents read, Pull requests read/write, Issues read/write for provenance comments, and Metadata read. Callers also need repository read access to inspect context and write access to publish.

The hosted web authorization flow requires a client secret, unlike local device flow. Bot publishing still requires the App private key. These credentials stay on the host; this service does not use the Mac's Keychain.

## OAuth and MCP

Connect to your public `/mcp` endpoint. OAuth metadata is advertised at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`.

Register a public client at `/register` with `token_endpoint_auth_method: none` and an exact configured redirect URI. Use authorization code flow through `/authorize`, PKCE S256, and `resource` equal to the full public `/mcp` URL. Request `kefania:read kefania:publish`, or only `kefania:read` for inspection. After browser authorization through GitHub, exchange the single-use code at `/token`. Clients receive Kefania credentials, never GitHub tokens.

Call `github_get_pull_request_context`, draft in the existing task using its conversation and the returned evidence, then call `github_create_pull_request` with the finished title/body and `headSha` as `expectedHeadSha`. No second inference runs. Do not publish a conversation transcript through the optional `prompt` field without explicit authorization. Source metadata must use the accepted conversation URL/UUID format; omit unsupported Codex Web task identifiers rather than inventing one.

OAuth MCP clients can use this service. Codex Web compatibility still needs a live check after deployment. This integration does not intercept its built-in Create PR button.

## HTTP handoff

Send `Authorization: Bearer …` using the same Kefania OAuth access token. JSON POSTs need `Content-Type: application/json`.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Public process liveness; does not verify GitHub configuration |
| `GET /api/rules` | Canonical drafting rules |
| `POST /api/context` | Repository comparison and verified head SHA |
| `POST /api/pull-requests` | Publish an already completed draft |

Context body:

```json
{"owner":"pony-factor","repo":"kefania","head":"your-branch","base":"main"}
```

Publication body:

```json
{
  "owner": "pony-factor",
  "repo": "kefania",
  "head": "your-branch",
  "base": "main",
  "expectedHeadSha": "replace-with-the-40-character-SHA-from-context",
  "title": "🔧 Improve the PR handoff",
  "body": "The finished Markdown description from the task conversation.",
  "draft": false
}
```

For a cloud task using HTTP, complete OAuth with a trusted client first, then use the cloud environment's secure network credential facility for this HTTPS host. Allow the necessary HTTP methods. Never paste tokens into chat. Browser-origin API calls are rejected; this HTTP interface is for server-side clients.

Repository permissions are checked on every operation. Changed heads are rejected and existing open PRs reused. Uncertain writes are not retried under another identity or through another model; check GitHub before retrying publication.

## Runtime and verification

Run one instance. OAuth state is bounded and stored in memory: a restart requires reconnecting clients, and multiple replicas require a shared store first. Host-managed App credentials persist independently. Access tokens expire after 15 minutes; refresh tokens rotate and sessions last at most eight hours or the upstream token lifetime. Revocation invalidates the session, and GitHub authorization is checked on authenticated requests.

Local tests cover OAuth over HTTP, a real MCP client, and bot API publication using mocked GitHub responses. Real GitHub sign-in, TLS/proxy behavior, and Codex Web remain unverified until deployment. Verify metadata, complete real OAuth, inspect a published test branch, publish the reviewed draft, and confirm the bot author and unchanged description.

[GitHub App authorization documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

[MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

[Codex cloud environment configuration](https://learn.chatgpt.com/docs/environments/cloud-environments)
