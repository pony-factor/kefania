# Kefania

Draft and publish pull requests from Sweetiebot using the canonical rules in `PULL_REQUEST.md`.

Keep this checkout beside the repository whose pull request you want to draft. Sweetiebot's New PR button opens ChatGPT with the selected repository, branch, base, and these rules. Select a branch other than the base first; the button is disabled on the base branch.

The drafting chat prefers the configured `codex-drafter` publishing tool. This repository contains drafting instructions, not an MCP server. When that tool is absent, the rules allow an authenticated GitHub publishing tool to create the PR with the same description attribution and a separate source-conversation comment. A publishing connection and a published branch with committed changes are required.

Opening the drafting chat does not stage, commit, or push local changes.
