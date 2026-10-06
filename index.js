/**
 * Context-budget hint — an out-of-tree DeepSeek Harness bundle.
 *
 * Adds one runtime-context contribution that states how much of the session's
 * prompt budget is in use and that automatic compaction is a safe fallback.
 * The contribution is re-rendered only when the rounded reading changes, so one
 * session accumulates a handful of snapshot messages rather than one per step.
 *
 * @module dsh-context-hint
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-budget-hint'

/** The prompt-assembly service that owns the runtime-context snapshot. */
export const inject = ['systemPrompt']

/**
 * Placement inside the runtime-context snapshot. First-party allocations are
 * 110 sandbox policy, 115 approval policy, and 120 subagent delegation; this
 * reads immediately after them.
 */
const CONTEXT_ORDER = 125

/**
 * Prompt fraction the compaction backend compacts at. Mirrors the shipped
 * `compaction-basic` default (`thresholdRatio` 0.8).
 */
const THRESHOLD_RATIO = 0.8

/**
 * Tokens the compaction backend keeps free above the reserved completion
 * budget. Mirrors the shipped `compaction-basic` default (`headroomTokens`).
 */
const HEADROOM_TOKENS = 65_536

/**
 * Percentage step of the reported reading. A larger step means fewer durable
 * snapshot messages; the reading is a coarse gauge, not a live meter.
 */
const BUCKET_PERCENT = 5

/** Rounding of the reported budget, in tokens. */
const BUDGET_ROUNDING = 10_000

/** The rule that holds in every band: pressure never lowers the standard of work. */
const CARE_SENTENCE = 'Context pressure is never a reason to reduce the care, verification, or '
  + 'completeness of the work in front of you: if room runs short, reduce scope and report exactly '
  + 'what is done and what is not — never quietly do less.'

/** What automatic compaction does, stated once so the sentence cannot drift between bands. */
const AUTOMATIC_SENTENCE = 'the harness compacts automatically — older history is summarized and '
  + 'the work continues, including part-way through a turn — so there is no point at which you must '
  + 'stop early, and nothing active is lost.'

/** The action clause for one reported percentage. */
function bandSentence(percent) {
  if (percent <= 45) return 'Plenty of room: continue at full care.'
  if (percent <= 80) return 'Still ample room: continue at full care.'
  return percent < 100
    ? `Approaching the automatic compaction point: when the budget is reached ${AUTOMATIC_SENTENCE}`
    : `At the automatic compaction point: ${AUTOMATIC_SENTENCE}`
}

/**
 * Render the model-facing hint for one context reading.
 *
 * The budget mirrors the compaction backend's effective pressure budget:
 * `min(contextWindow * thresholdRatio, contextWindow - reservedCompletion - headroom)`.
 * A reading against the raw window would report room the backend does not have.
 *
 * @param {{ usedTokens?: number, contextWindow?: number, reservedTokens?: number }} reading
 *   provider-anchored prompt occupancy, the routed context window, and the
 *   completion tokens the routed request reserves.
 * @returns {string | undefined} the hint, or `undefined` when there is nothing usable to report.
 */
export function formatContextHint(reading) {
  const usedTokens = reading?.usedTokens
  const contextWindow = reading?.contextWindow
  if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens) || usedTokens <= 0) return undefined
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined
  }
  const reservedTokens = typeof reading.reservedTokens === 'number'
    && Number.isFinite(reading.reservedTokens)
    ? Math.max(0, reading.reservedTokens)
    : 0
  const budget = Math.floor(Math.min(
    contextWindow * THRESHOLD_RATIO,
    contextWindow - reservedTokens - HEADROOM_TOKENS,
  ))
  if (budget <= 0) return undefined

  const percent = Math.min(100, Math.max(
    0,
    Math.round((usedTokens / budget) * 100 / BUCKET_PERCENT) * BUCKET_PERCENT,
  ))
  const budgetK = Math.round(budget / BUDGET_ROUNDING) * (BUDGET_ROUNDING / 1000)
  return `Context: ~${percent}% of this session's ~${budgetK}k-token prompt budget is in use. `
    + `${bandSentence(percent)}\n${CARE_SENTENCE}`
}

/**
 * Read the current reading from the session projections and render the hint.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context; optional services are read through `get`.
 * @param {object} session - the agent's session.
 * @returns {string | undefined} the hint, or `undefined` when no reading is available.
 */
function readContextHint(ctx, session) {
  const projections = ctx.get('sessionProjections')
  if (projections === undefined) return undefined
  const pressure = projections.snapshot(session, ['contextPressure'])?.values?.contextPressure
  if (pressure === undefined) return undefined
  const usedTokens = pressure.projectedTokens ?? pressure.pressureTokens
  const routed = session.requestContext?.()
  const contextWindow = routed?.contextWindow ?? pressure.contextWindow
  const reservedTokens = session.requestHeader?.()?.config?.maxTokens
  return formatContextHint({ usedTokens, contextWindow, reservedTokens })
}

/**
 * Register the runtime-context contribution for the lifetime of `ctx`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context; the contribution is disposed with it.
 */
export function apply(ctx) {
  let warned = false
  ctx.systemPrompt.context({
    name: 'context-budget',
    order: CONTEXT_ORDER,
    text: (assembly) => {
      const session = assembly?.agent?.session
      if (session === undefined) return ''
      try {
        return readContextHint(ctx, session) ?? ''
      } catch (error) {
        if (!warned) {
          warned = true
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn(`context-budget-hint: context reading unavailable: ${message}`)
        }
        return ''
      }
    },
  })
}
