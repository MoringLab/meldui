# Online baseline — 2026-10-09

108 independent jobs through local OmniRoute: 30 prompts per model in neutral, plus six per model in editorial. Structural validity and resolved expressions were evaluated. User-facing semantics were not graded by another model. Each failed generation could receive at most two repair attempts.

| Requested route | First-pass neutral | After up to two repairs |
|---|---:|---:|
| cx/gpt-5.6-sol-medium | 25/30 | 29/30 |
| agy/claude-sonnet-4-6 | 22/30 | 28/30 |
| agy/gemini-3.7-flash-medium | 16/30 | 26/30 |

Initial targets (27 first-pass, 29 repaired per 30) are not met by every model. Common failures: malformed NDJSON and invalid component schemas/graphs. Do not treat this as production release approval or conceal failures by excluding prompts. Detailed local results are in artifacts/online-eval.json; these aggregate results retain the complete denominator. Provider identity is recorded only if supplied by the gateway response.
