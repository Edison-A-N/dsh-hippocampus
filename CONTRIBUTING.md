# Contributing

Bug reports and pull requests are welcome.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug

Open an [issue](https://github.com/Edison-A-N/dsh-hippocampus/issues) with:

- the DSH version (`dsh --version`) and, for panel problems, the browser,
- what happened and what you expected,
- which `HIPPOCAMPUS_*` variables are set (names only, never keys).

Please do not paste memories, session content or summaries you would not
want to be public.

## Making a change

```bash
npm install
npm run build:client   # bundles client/src into lib/client.js
npm test
```

- Read [AGENTS.md](AGENTS.md) first: it lists the ground rules (zero runtime
  dependencies, no hardcoded endpoints, cache semantics) and the docs
  policy.
- `lib/client.js` is committed because DSH loads it as-is. Rebuild it in the
  same commit as any change under `client/src`.
- Add or update a test in `tests/` for every behavior change. Before
  changing `lib/commit.js` or either compaction engine, also run the
  host-contract tests: `DSH_HOST_NODE_MODULES=<dsh install>/node_modules/.pnpm/node_modules npm test`.
- Keep `README.md` and `README.zh.md` in sync.
- If a change contradicts an ADR in `docs/adr/`, update the ADR in the same
  pull request.
