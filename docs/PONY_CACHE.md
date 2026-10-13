# Local pony lookup cache

Kefania retains local Sweetiebot character research so repeated lookups of the same pony can reuse an existing sourced profile instead of opening a new ChatGPT research session. Profiles remain completely separate from pull-request drafting and GitHub publication.

Sweetiebot calls node src/pony-cache.js with one JSON object on stdin:

* Before launching pony research, pass action=get and the recognized pony catalog match. When hit=true, use the returned profile in the local confirmation page and skip the pony ChatGPT workflow.
* After a complete profile is accepted by the local confirmation page, pass action=put, the same pony metadata, and the profile text. A successful response returns stored=true.
* To explicitly re-research a pony, pass action=remove with its metadata; the next lookup is a miss.

The key hashes the cache version, pack ID, canonical slug (when supplied), and HTTPS catalog source. This separates same-name G4/G5 characters, unifies branch-name aliases, and invalidates cache entries if the source changes. Profiles expire after 90 days. Missing, stale, and corrupt entries are cache misses. Cached profiles are limited to 60 KB.

Local JSON records are atomically written with file mode 0600 to ~/.cache/kefania/pony-profiles, or under XDG_CACHE_HOME, or to KEFANIA_PONY_CACHE_DIR if set. The CLI never sends a profile to GitHub, invokes a model, or handles account credentials. Cache problems must never block PR creation.

A compatible Sweetiebot client must call this CLI at both the preflight and completion stages; installing Kefania alone does not change ChatGPT browser launches.
