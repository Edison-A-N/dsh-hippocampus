# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this repo is

A DSH (DeepSeek Harness) plugin: project memory + background context management. It runs *inside* a DSH host process — services like `ctx.tools`, `ctx.llm`, `ctx.tokenMeter` are provided by the host at runtime and are **not** npm dependencies of this package. It cannot run standalone.

Requirements & architecture decisions live in `docs/req/` and `docs/adr/` — read the relevant one before changing a subsystem; if a change contradicts an ADR, update the ADR in the same commit.

## Layout

```
lib/
  index.js        plugin entry: tool registration, baseline injection, dreamer, compaction wiring
  store.js        SQLite schema + MemoryStore (FTS5 bigram tokenizer lives here)
  identity.js     project identity (git root-commit sha; dir hash fallback)
  baseline.js     <project-memory> message composition
  embedding.js    OpenAI-compatible embeddings client + blob/vector helpers
  dreamer.js      background maintenance state machine (verify/curate, leases)
  compaction.js   single-checkpoint engine (BackgroundLane + HippocampusCompaction; ADR-7, now the fallback)
  compartments.js compartment math and text: budgets, protected tail, decay tiers, historian prompt/parser (pure)
  historian.js    default engine: background compartment summaries, cache-cold commits (ADR-9)
  reclaim.js      tool-output reclaim (ADR-10)
  commit.js       shared surface-replace transaction for both engines
  webapi.js       JSON API for the Web panels (Host/Origin + cookie fenced)
  client.js       built Web panel bundle (from client/src; committed)
client/src/       Web panel source (React, bundled by client/build.mjs)
cordis.patch.yml  bundle patch: disables compaction-basic, inserts the hippocampus row
tests/            node:test suites; no network, no DSH host needed
docs/
  req/            requirement docs (what & why, acceptance criteria)
  adr/            architecture decision records
  tech/           design notes & prior-art survey
```

## Ground rules

- **Zero npm runtime dependencies** — keep it that way. Storage is `node:sqlite`; everything else is Node built-ins. Do not add an ORM, a vector DB, or an embedding runtime (ADR-1, ADR-6).
- **No hardcoded endpoints or provider names.** Anything environment-specific arrives via `HIPPOCAMPUS_*` env vars resolved through the launch environment (see `embeddingClientFrom` / `registerDreamer`). Defaults must be public/neutral values.
- **DSH core stays untouched.** The plugin rides documented seams only (`CompactionEngine` contract, `ctx.llm.stream`, events). Never assume a per-request message-rewrite hook exists — it does not, by contract (ADR-3).
- **Background work never touches a live session's surface.** Dreamer and embedding results land in the plugin's own SQLite only (REQ-2.5).
- **Tool outputs must be lossless JSON.** Raw store rows carry embedding BLOBs — always go through the projection before returning anything to the model (`projectMemory` in `lib/index.js`); there is a test that fails on leakage.
- **Cache semantics are a correctness constraint**: baseline injection is once per session and append-only; nothing rewrites or re-injects what is already inside the conversation prefix (ADR-5).

## Tests

```sh
npm test        # node:test, no network, no host required (host-contract tests skip)
```

- Add or update a test with every behavior change; the suites cover the store, tokenizer, identity, baseline, embedding client, dreamer state machine, both compaction engines, reclaim, tool output shape, and the Web API.
- Tests must pass from a plain git clone (identity tests resolve `process.cwd()` as a git repo — they require the repo to have at least one commit).
- SQLite tests use throwaway temp dirs; never point tests at a real `DSH_HOME`.
- `tests/host-contract.test.js` checks the compaction event contract against the real DSH host packages. It skips unless `DSH_HOST_NODE_MODULES` points at a DSH install's `node_modules/.pnpm/node_modules`; run it that way before changing `lib/commit.js` or either engine.

## Conventions

- Host side: ESM (`"type": "module"`), plain JSDoc comments, no build step, no TypeScript. The Web panel under `client/src` is TypeScript/React built with esbuild; rebuild `lib/client.js` (`npm run build:client`) in the same commit as any change there.
- Text the plugin injects into sessions or returns from tools is English; it must not set the session's language.
- Node >= 22.19 (`node:sqlite` requirement).
- Comment style: explain *why* (constraints, cache semantics, failure modes), not *what*.
- Env-var knobs follow `HIPPOCAMPUS_<SUBSYSTEM>_<FIELD>`; optional features degrade silently when their env is unset (see the config table in README.md).
- Commit messages: imperative, one line; prefix with the subsystem when it helps (`compaction:`, `dreamer:`, `docs:`).

## Syncing designs from upstream projects

hippocampus keeps adopting designs from [magic-context](https://github.com/cortexkit/magic-context) (MIT) and DSH packages (MIT). Each sync follows these steps:

1. Check the LICENSE at the exact upstream commit you study. If it is no longer MIT (or another permissive license), stop at the last permissive commit and implement anything newer from your own design only.
2. Skip upstream files under a different license (for example magic-context's `packages/plugin/src/hooks/magic-context/__fixtures__/`, which holds Apache-2.0 code from Vercel). Using one requires that license's own terms (Apache-2.0: keep its NOTICE and mark changes).
3. Prefer reimplementing over copying. When text or code is copied or translated line by line, credit the source in a comment at that spot.
4. Update `THIRD_PARTY_NOTICES.md` in the same change: the "Studied up to" commit, the list of what is adapted, and the copyright line exactly as it reads at that commit.
5. Never present hippocampus as an official port or as endorsed by the upstream project.

## Docs policy

- New capability: add a `docs/req/REQ-N` doc (background, requirements, acceptance criteria).
- New significant decision or reversal: add/update a `docs/adr/ADR-N` doc, including the rejected alternatives.
- README (English primary) + `README.zh.md` (Chinese) must stay in sync — change both or neither.
