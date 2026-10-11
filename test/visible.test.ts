import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripThinking, previewOf, partLooksLikeThinking } from '../shared/visible'

// ── stripThinking ─────────────────────────────────────────────────────────────

describe('stripThinking', () => {
  it('strips a <think> block', () => {
    const result = stripThinking('Before<think>internal chain of thought</think>After')
    assert.equal(result, 'BeforeAfter')
  })

  it('strips a <thinking> block', () => {
    const result = stripThinking('<thinking>reasoning here</thinking>The answer is 42.')
    assert.equal(result, 'The answer is 42.')
  })

  it('strips a <reasoning> block', () => {
    const result = stripThinking('<reasoning>private</reasoning>Public result.')
    assert.equal(result, 'Public result.')
  })

  it('strips a fenced ```thinking block', () => {
    const result = stripThinking('```thinking\nsome chain of thought\n```\nFinal answer.')
    assert.equal(result, 'Final answer.')
  })

  it('strips a fenced ```reasoning block', () => {
    const result = stripThinking('```reasoning\nstep 1\nstep 2\n```\nResult.')
    assert.equal(result, 'Result.')
  })

  it('truncates at an unclosed <think> tag', () => {
    const result = stripThinking('Good part.<think>leaked reasoning')
    assert.equal(result, 'Good part.')
  })

  it('is case-insensitive for tags', () => {
    const result = stripThinking('<THINK>secret</THINK>answer')
    assert.equal(result, 'answer')
  })

  it('returns unchanged text when no thinking markers are present', () => {
    assert.equal(stripThinking('just a normal reply'), 'just a normal reply')
  })

  it('handles empty string', () => {
    assert.equal(stripThinking(''), '')
  })

  it('handles multiple thinking blocks in one string', () => {
    const result = stripThinking('<think>a</think>middle<think>b</think>end')
    assert.equal(result, 'middleend')
  })

  it('trims leading/trailing whitespace from the result', () => {
    const result = stripThinking('<think>hidden</think>   trimmed   ')
    assert.equal(result, 'trimmed')
  })
})

// ── previewOf ─────────────────────────────────────────────────────────────────

describe('previewOf', () => {
  it('returns the first 140 characters by default', () => {
    const long = 'a'.repeat(200)
    assert.equal(previewOf(long).length, 140)
  })

  it('respects a custom max length', () => {
    assert.equal(previewOf('hello world', 5).length, 5)
    assert.equal(previewOf('hello world', 5), 'hello')
  })

  it('strips thinking before previewing', () => {
    const preview = previewOf('<think>private</think>The result is here.')
    assert.doesNotMatch(preview, /private/)
    assert.match(preview, /result is here/)
  })

  it('collapses whitespace', () => {
    const preview = previewOf('line one\n\n\nline two')
    assert.doesNotMatch(preview, /\n/)
    assert.match(preview, /line one line two/)
  })

  it('returns empty for blank input', () => {
    assert.equal(previewOf(''), '')
    assert.equal(previewOf('   '), '')
  })

  it('returns empty when text is all thinking', () => {
    assert.equal(previewOf('<think>everything is hidden</think>'), '')
  })
})

// ── partLooksLikeThinking ─────────────────────────────────────────────────────

describe('partLooksLikeThinking', () => {
  it('identifies type=reasoning as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'reasoning' }), true)
  })

  it('identifies type=thinking as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'thinking' }), true)
  })

  it('identifies type=thought as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'thought' }), true)
  })

  it('identifies kind=reasoning as thinking', () => {
    assert.equal(partLooksLikeThinking({ kind: 'reasoning' }), true)
  })

  it('identifies thinking=true flag as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'text', thinking: true }), true)
  })

  it('identifies reasoning=true flag as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'text', reasoning: true }), true)
  })

  it('does not flag type=text as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'text' }), false)
  })

  it('does not flag type=tool as thinking', () => {
    assert.equal(partLooksLikeThinking({ type: 'tool' }), false)
  })

  it('handles an empty object without throwing', () => {
    assert.equal(partLooksLikeThinking({}), false)
  })
})
