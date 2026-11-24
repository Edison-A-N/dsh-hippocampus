# Security Policy

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/Edison-A-N/dsh-hippocampus/security/advisories/new)
rather than a public issue.

Relevant areas:

- The `/plugins/hippocampus/api/*` routes (Web profile only). Every route
  must pass DSH's Host/Origin check and its login cookie check, the same
  ones the Web UI uses. The write routes (`memories/edit`,
  `memories/archive`, `dreamer/run`) also require a JSON body, so a
  cross-site form cannot reach them.
- The store under `$DSH_HOME/storages/hippocampus/`. The directory is `0700`
  and the database files `0600`; it holds memory text and session summaries.
- Text injected into sessions. The `<project-memory>` baseline and the
  `<ctx-search-hint>` carry memory text that agents wrote, possibly copied
  from untrusted input. Tags inside that text are escaped, and the header
  frames the block as records to check, not instructions.
- The dreamer's evidence reader. It reads only files git tracks in the
  project whose real path stays inside it, skips files over 512 KB,
  binaries and secret-looking paths, and runs git without external diff or
  textconv drivers.
- Model and embedding calls. They go only to the routes configured through
  the `HIPPOCAMPUS_*` variables or the session's own model; see
  "Data and privacy" in the README.

Only the latest release is supported.
