# GitHub publishing style

`PULL_REQUEST.md` contains the canonical drafting and description-image rules. The model supplies the substantive title and body; the server owns publication.

- PRs default to draft unless the caller explicitly sets `draft: false`.
- The server appends the canonical centered, linked description image exactly once.
- When a PR caller supplies `prompt`, publish it verbatim under `## AI Prompt`, then replace it with the finished description. GitHub edit history retains the prompt. Issue creation requires this argument.
- Publish only prompt text the user authorized for GitHub. Conversation UUIDs, source URLs, and intent summaries are recorded through `source` in a separate PR comment.
- Do not put references to Codex or AI in the PR title or imply that description attribution applies to the repository changes.
- An existing open PR for the same head/base is returned without replacing its title or description.
- If creation succeeds but a subsequent edit or comment fails, return the published URL and the failed step. Repair that item instead of creating another.

The prior configurable collapsed banner has been replaced by the canonical description image. `CODEX_BANNER_URL` and `CODEX_BANNER_LINK` are no longer used.
