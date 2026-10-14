# Curated pony records

This directory holds durable, human-reviewed character research as JSON files. Each pony has one file at `<pack-id>/<canonical-slug>.json` (for example, `g4-mares/berry-punch.json`).

The profile is reusable text; `sources` are attributed HTTPS reference pages; `artwork` is a list of attributed HTTPS image URLs that rotate weekly when viewed, without refreshing or overwriting character facts.

The Kafania `curate_pony` MCP prompt guides research and requests explicit approval before `pony_curate_profile` modifies a local file. A Sweetiebot first lookup may create an unreviewed `draft`, but never replaces an existing record. Reviewed records do not expire.

Changes stay uncommitted until separately reviewed and committed. See [the library guide](../docs/PONY_CACHE.md).
