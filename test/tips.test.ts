import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assistantText, FALLBACK_TIPS, splitTips } from '../electron/tips'

// ── splitTips ─────────────────────────────────────────────────────────────────

describe('tips — splitTips', () => {
  it('splits lines into tips', () => {
    const tips = splitTips('Sleep a full eight hours.\nMove your body every day.\nRead before bed.')
    assert.deepEqual(tips, ['Sleep a full eight hours.', 'Move your body every day.', 'Read before bed.'])
  })

  it('strips list markers, numbering, and surrounding quotes', () => {
    const tips = splitTips('- "Protect your mornings for deep work."\n1. Ask better questions.\n• 2) Breathe before you reply.')
    assert.deepEqual(tips, ['Protect your mornings for deep work.', 'Ask better questions.', 'Breathe before you reply.'])
  })

  it('drops fragments that are too short or too long', () => {
    const long = `x${'y'.repeat(300)}`
    const tips = splitTips(['ok', 'Write down the next physical step you can take.', long].join('\n'))
    assert.deepEqual(tips, ['Write down the next physical step you can take.'])
  })

  it('returns an empty list for blank input', () => {
    assert.deepEqual(splitTips('\n\n  \n'), [])
  })
})

// ── assistantText ─────────────────────────────────────────────────────────────

describe('tips — assistantText', () => {
  it('reads assistant text parts from a plain message array', () => {
    const raw = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'ask' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'tip one' }, { type: 'text', text: 'tip two' }] },
    ]
    assert.equal(assistantText(raw), 'tip one\ntip two')
  })

  it('wraps a { messages } envelope and ignores non-text parts', () => {
    const raw = {
      messages: [
        { info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'visible' }] },
      ],
    }
    assert.equal(assistantText(raw), 'visible')
  })

  it('returns an empty string when there is nothing to read', () => {
    assert.equal(assistantText(null), '')
    assert.equal(assistantText([{ info: { role: 'user' }, parts: [] }]), '')
  })
})

// ── fallbacks ─────────────────────────────────────────────────────────────────

describe('tips — fallbacks', () => {
  it('ships a non-empty fallback list with usable lines', () => {
    assert.ok(FALLBACK_TIPS.length >= 3)
    for (const tip of FALLBACK_TIPS) assert.ok(tip.length >= 12)
  })
})
