# dsh-context-hint

An out-of-tree [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that tells the model how much of its context budget is in use, and that the harness compacts automatically before the budget runs out.

Without a reading, a model judges its remaining context from how long the conversation feels. Long sessions then produce a false "I am running out" and the work stops early, gets narrowed, or loses its checks — well before anything would actually happen. Measured from one long recorded session, the model declared its budget exhausted at 57% of the point where compaction actually fires, including a turn that said "context is nearly used up" and, thirteen steps later in the same turn, "context is roomy". Supplying the real number is what changed its behaviour.

## What the model sees

One line, re-rendered only when the rounded reading changes (a handful of times per session):

```
Context: ~75% of this session's ~680k-token prompt budget is in use. Approaching the
automatic compaction point: when the budget is reached the harness compacts
automatically — older history is summarized and the work continues, including part-way
through a turn — so there is no point at which you must stop early, and nothing active
is lost.
Context pressure is never a reason to reduce the care, verification, or completeness of
the work in front of you: if room runs short, reduce scope and report exactly what is
done and what is not — never quietly do less.
```

It arrives as part of the harness's runtime-context snapshot, so it supersedes the previous snapshot and is attributed to this plugin in the session log.

## Install

```sh
dsh plugin --profile <profile> add github:Elevator14B/dsh-context-hint
```

Nothing runs at install time: the package is plain ESM JavaScript with no dependencies, no build step, and no `prepare` script, so no pnpm build allowance is needed.

For a local checkout:

```sh
dsh plugin --profile <profile> add /path/to/dsh-context-hint
```

Confirm the layer, then restart the app:

```sh
dsh --profile <profile> --dump-config   # shows a "# == dsh-context-hint" layer
```

## How the reading is computed

| Input | Source |
| --- | --- |
| Tokens in use | `contextPressure` session projection (`projectedTokens`, else `pressureTokens`) — the provider-reported prompt size, adjusted for everything the surface gained or lost since that sample, so it drops immediately after a compaction |
| Context window | the session's latest `request/context` |
| Reserved completion | the routed request's `maxTokens` |

The reported budget mirrors the compaction backend's effective pressure budget:

```
budget = min(contextWindow * 0.8, contextWindow - reservedCompletion - 65536)
```

For the shipped DeepSeek route (1M window, 256k reserved) that is 678,464 tokens — 68% of the window — which is exactly where the harness compacts. Reporting against the raw window would promise room the backend does not have.

The reading is quantised to 5% steps before rendering, because the runtime-context snapshot appends a durable message whenever its text changes; a live number would add one message per step.

## Bands

| Reading | Clause |
| --- | --- |
| ≤ 45% | Plenty of room: continue at full care. |
| 50–80% | Still ample room: continue at full care. |
| 85–99% | Approaching the automatic compaction point, with what compaction does. |
| 100% | At the automatic compaction point, with what compaction does. |

The no-quality-reduction rule is in every band.

## Limitations

- The budget constants mirror the shipped `compaction-basic` defaults (`thresholdRatio` 0.8, `headroomTokens` 65536). A deployment that configures different values will see a reading that is off by the same ratio; the constants are at the top of [`index.js`](./index.js).
- The plugin has no configuration schema, so the constants are edited in source rather than in `cordis.yml`.
- A route whose adapter advertises no context window, or a session before its first provider response, produces no reading and no message.
- `reservedCompletion` falls back to 0 when the durable request header carries no `maxTokens`, which overstates the budget for that route.

## Uninstall

```sh
dsh plugin --profile <profile> remove dsh-context-hint
```

## Development

```sh
node --test
```

## License

MIT
