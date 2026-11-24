# Third-party notices

dsh-hippocampus is licensed under the MIT License (see [LICENSE](LICENSE)).
It contains material adapted from the projects below. Their notices are
reproduced as their licenses require.

## DeepSeek Harness: `@deepseek-ai/dsh-compaction-basic`

- Source: https://github.com/deepseek-ai/deepseek-harness
- Used in: `lib/compaction.js` (`COMPACTION_INSTRUCTION`, the 8-section
  checkpoint directive, and `CHECKPOINT_PREAMBLE`). The text is adapted from
  the stock compaction backend so checkpoints keep its format.

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## magic-context

- Source: https://github.com/cortexkit/magic-context
- Studied up to: commit `642d52816fbdae37ba5359b4e3166fb1a4afe279`
  (2026-11-20), MIT at that commit. Update this line on every sync.
- Not affiliated with or endorsed by the magic-context project.
- Used in: the design of the context-management and curation subsystems
  (`lib/compartments.js`, `lib/historian.js`, `lib/dreamer.js`,
  `lib/baseline.js`): the protected-tail and decay-curve formulas and their
  constants, the memory selection order, the per-category admission rubric
  in the `ctx_memory` tool description, the structure of the historian
  prompt (work units, four summary tiers, `U:` quotes; `lib/compartments.js`),
  and the dreamer's verify/curate task prompts and safety gates
  (`lib/dreamer.js`). The prompts are rewritten rather than copied.
  hippocampus is an independent JavaScript implementation for DSH; no
  source files are copied.
  `docs/tech/magic-context-notes.md` records what was studied.

```
MIT License

Copyright (c) 2025 Ufuk Altinok

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
