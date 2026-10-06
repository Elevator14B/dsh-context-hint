import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatContextHint } from '../index.js'

/** The shipped DeepSeek route: a 1M window with 256k reserved for completion. */
const WINDOW = 1_000_000
const RESERVED = 256_000
// budget = min(1_000_000 * 0.8, 1_000_000 - 256_000 - 65_536) = 678_464, reported as ~680k.

test('reports against the compaction budget rather than the raw window', () => {
  const text = formatContextHint({ usedTokens: 339_232, contextWindow: WINDOW, reservedTokens: RESERVED })
  assert.match(text, /~50% of this session's ~680k-token prompt budget/)
})

test('leaves the low band reassuring', () => {
  const text = formatContextHint({ usedTokens: 100_000, contextWindow: WINDOW, reservedTokens: RESERVED })
  assert.match(text, /Plenty of room/)
  assert.doesNotMatch(text, /compaction point/)
})

test('names the automatic fallback before the budget is reached', () => {
  const text = formatContextHint({ usedTokens: 650_000, contextWindow: WINDOW, reservedTokens: RESERVED })
  assert.match(text, /~95%/)
  assert.match(text, /Approaching the automatic compaction point/)
})

test('clamps an over-budget reading', () => {
  const text = formatContextHint({ usedTokens: 900_000, contextWindow: WINDOW, reservedTokens: RESERVED })
  assert.match(text, /~100%/)
  assert.match(text, /At the automatic compaction point/)
})

test('carries the no-quality-reduction rule in every band', () => {
  for (const usedTokens of [1_000, 400_000, 678_464, 900_000]) {
    assert.match(
      formatContextHint({ usedTokens, contextWindow: WINDOW, reservedTokens: RESERVED }),
      /never quietly do less/,
    )
  }
})

test('stays stable inside one reported bucket', () => {
  const first = formatContextHint({ usedTokens: 500_000, contextWindow: WINDOW, reservedTokens: RESERVED })
  const second = formatContextHint({ usedTokens: 505_000, contextWindow: WINDOW, reservedTokens: RESERVED })
  assert.equal(first, second)
})

test('declines to report without a usable reading', () => {
  assert.equal(formatContextHint({}), undefined)
  assert.equal(formatContextHint({ usedTokens: 0, contextWindow: WINDOW }), undefined)
  assert.equal(formatContextHint({ usedTokens: 1_000 }), undefined)
})

test('declines when routing leaves no prompt budget', () => {
  assert.equal(
    formatContextHint({ usedTokens: 1_000, contextWindow: 100_000, reservedTokens: 100_000 }),
    undefined,
  )
})

test('falls back to the window fraction for a route with no completion reservation', () => {
  // min(128_000 * 0.8, 128_000 - 0 - 65_536) = 62_464, reported as ~60k.
  const text = formatContextHint({ usedTokens: 31_232, contextWindow: 128_000 })
  assert.match(text, /~50% of this session's ~60k-token prompt budget/)
})
