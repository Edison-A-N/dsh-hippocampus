# Changelog

## Unreleased

- `ctx_reduce`: the agent can mark tool outputs it no longer needs, by tool
  name and an argument fragment or by seq. Marks only queue; the outputs
  become placeholders on the next pass that rewrites the prefix anyway, so a
  call never costs a cache bust of its own. Compartment engine only.
- Tiered pressure reclaim: at the force band, at 95% and on overflow, tool
  output that is still current is reclaimed by tool kind (shell and web
  first, file reads, plans and sub-agent reports last), oldest first; the
  newest round's results always stay.
- The historian also returns durable project facts, stored as
  `source_type = historian` memories at importance 40. A fact that matches
  any stored row only counts as seen, so archived memories stay archived.
  `HIPPOCAMPUS_HISTORIAN_FACTS=off` turns it off.
- The Web API works on DSH 0.2.3, where the login and Host/Origin checks
  moved into the web server's route admission (the routes answered 500
  there before). DSH 0.2.2 keeps the in-handler checks.

## 0.2.0

First public release.

- Ships as a DSH bundle: `dsh plugin --profile web add github:Edison-A-N/dsh-hippocampus`
  installs it in one step. The bundle patch disables the host-level
  `compaction-basic` row and inserts the `hippocampus` row.
- `ctx_memory` get/update/archive only reach memories of the current
  project; ids from another project read as not found.
- The baseline and search-hint text injected into sessions is in English,
  and tags inside memory text are escaped so a memory cannot close the
  `<project-memory>` block.
- Full-text search indexes Japanese and Korean like Chinese (bigrams) and
  keeps accented and non-Latin words whole. Existing stores rebuild their
  full-text index once on open.
- The store directory is `0700` and the database files `0600`.
- The Web API routes check Host/Origin before the login cookie, the write
  routes require a JSON body, and unexpected errors answer a generic 500.
- `ctx_search` reports `sessionSearch: "disabled"` or `"unavailable"` when
  the session-history lane is off.
