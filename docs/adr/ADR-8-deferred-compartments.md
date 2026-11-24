# ADR-8: Deferred — compartment tiers, decay rendering, historian capture

## Status

Partly superseded by [ADR-9](ADR-9-compartment-compaction.md) (2026-11-05): compartments with decay rendering are implemented; historian fact capture stays deferred.

## Context

Three magic-context mechanisms were consciously cut from the first shipped version:

1. **Compartments with decay rendering** — history compressed into segments, each stored at 4 summary tiers + an importance score; rendering picks a tier via a pure-function decay curve (H = H₀·2^((imp−50)/D)/pressure), re-tiering only at folds. Zero model calls, budget self-adjusting (H ∝ 1/p).
2. **Historian capture** — facts extracted *while* compacting, promoted into memories inside the same publish transaction (mem0's pipeline folded into the historian).
3. **ctx_expand / ctx_note** — restoring original text of dropped spans; session notes.

## Decision

Defer all three. The current compaction (ADR-7) uses the stock single-checkpoint shape; the memory layer is agent-written only.

Rationale:

- Compartments need the fold path to render tiers into — under ADR-3 that means packing the decay render into the replace event, which is a substantially different (and riskier) commit path than the reused stock template. The latency win of ADR-7 was the highest-value slice; compartments are a quality upgrade, not an enabler.
- Historian capture without compartments has no natural extraction moment (it rides the historian's publish transaction).
- The stock backend's single checkpoint already satisfies the 8-section battle-tested summary; tiers improve fidelity under repeated folds, which matters at much longer session lifetimes than we currently see.

Revisit triggers: (a) real sessions regularly reaching multiple sequential compactions, (b) measurable summary-fidelity loss at fold 2+, (c) demand for cross-session history recall beyond what `ctx_search` + session queries give.

## Consequences

- Single checkpoint per fold: a second compaction of a session summarizes the previous checkpoint again (summary-of-summary). At current depths this is fine; at depth 3+ it degrades.
- No automatic fact capture during compaction — memories come from the agent's own writes and the dreamer's curation.
- The decay-curve design notes survive in [tech/magic-context-notes.md](../tech/magic-context-notes.md) so the deferral is cheap to reverse.
