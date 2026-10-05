# GitHub publishing style

Codex Drafter is the final publishing layer for issues and pull requests created through its MCP tools.

## Rules

- Every issue and pull request is initially created with `## AI Prompt`, a blank line, and the exact `prompt` value supplied by the caller.
- Preserve `prompt` byte-for-byte as text: do not trim, normalize whitespace, correct spelling, or otherwise rewrite the user's input.
- After creation, replace the item body with the final `body`; prompt provenance should remain in GitHub's edit history rather than the current body.
- Pull requests are drafts by default unless the caller explicitly requests otherwise.
- The caller supplies the substantive title and body; the server should not silently rewrite their meaning.
- Do not put references to Codex or AI in the PR title.
- Preserve the caller's PR body and append the authorship disclosure as the final block.
- Keep substantive drafting guidance in `PULL_REQUEST.md`; clients should load or defer to that file rather than maintaining their own copy.
- When a real conversation source is supplied, preserve its UUID and URL exactly and add it as a separate provenance comment.
- Never invent a ChatGPT or Codex source UUID. An absent source is better than a fabricated one.
- Keep the optional conversation-intent summary brief and distinct from the diff-based PR description.
- The disclosure is always collapsed inside `<details>`.
- When `CODEX_BANNER_URL` is configured, the banner itself is clickable and links to `CODEX_BANNER_LINK`.
- If the banner URL is unavailable, use a linked text credit rather than a broken image.

The point of keeping these rules in the server is that Codex does not need to remember them separately in every repository.
