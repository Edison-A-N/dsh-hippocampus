# Changelog

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
