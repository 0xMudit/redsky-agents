import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseMentions, buildHandoffPrompt } from '../electron/collab'

const bots = [
  { id: 'bot_1', name: 'Sales Bot' },
  { id: 'bot_2', name: 'Bug Bot' },
  { id: 'bot_3', name: 'Bot' }, // short name — must not shadow longer ones
]

// ── parseMentions ─────────────────────────────────────────────────────────────

describe('parseMentions', () => {
  it('finds a single @mention', () => {
    const { mentions, remainder } = parseMentions('@Sales Bot please draft outreach', bots)
    assert.equal(mentions.length, 1)
    assert.equal(mentions[0].botId, 'bot_1')
    assert.equal(mentions[0].name, 'Sales Bot')
  })

  it('removes the mention from the remainder', () => {
    const { remainder } = parseMentions('@Sales Bot please draft outreach', bots)
    assert.doesNotMatch(remainder, /@Sales Bot/)
    assert.match(remainder, /please draft outreach/)
  })

  it('finds multiple @mentions in one message', () => {
    const { mentions } = parseMentions('@Sales Bot and @Bug Bot work together', bots)
    assert.equal(mentions.length, 2)
    assert.ok(mentions.some((m) => m.botId === 'bot_1'))
    assert.ok(mentions.some((m) => m.botId === 'bot_2'))
  })

  it('is case-insensitive for @Name', () => {
    const { mentions } = parseMentions('@sales bot help me', bots)
    assert.equal(mentions.length, 1)
    assert.equal(mentions[0].botId, 'bot_1')
  })

  it('returns empty mentions when no @Name matches', () => {
    const { mentions, remainder } = parseMentions('just a normal message', bots)
    assert.equal(mentions.length, 0)
    assert.equal(remainder, 'just a normal message')
  })

  it('does not match a partial name (word boundary)', () => {
    // @Bot should match bot_3 "Bot" but not "Sales Bot" or "Bug Bot"
    const { mentions } = parseMentions('@Bot do this', bots)
    assert.equal(mentions.length, 1)
    assert.equal(mentions[0].botId, 'bot_3')
  })

  it('is idempotent — same mention twice produces one entry', () => {
    const { mentions } = parseMentions('@Sales Bot and @Sales Bot again', bots)
    assert.equal(mentions.filter((m) => m.botId === 'bot_1').length, 1)
  })

  it('handles empty bots array', () => {
    const { mentions } = parseMentions('@Sales Bot hello', [])
    assert.equal(mentions.length, 0)
  })

  it('handles empty text', () => {
    const { mentions, remainder } = parseMentions('', bots)
    assert.equal(mentions.length, 0)
    assert.equal(remainder, '')
  })

  it('handles bot names with special regex characters', () => {
    const specialBots = [{ id: 'bot_x', name: 'C++ Bot' }]
    // Should not throw — escapeRegExp must handle the + chars
    assert.doesNotThrow(() => parseMentions('@C++ Bot help', specialBots))
  })
})

// ── buildHandoffPrompt ────────────────────────────────────────────────────────

describe('buildHandoffPrompt', () => {
  it('includes the from name and job in the header', () => {
    const prompt = buildHandoffPrompt({
      fromName: 'Sales Bot',
      fromJob: 'outreach',
      remainder: 'draft a follow-up',
      threadTail: '',
    })
    assert.match(prompt, /\[handoff from Sales Bot/)
    assert.match(prompt, /outreach/)
  })

  it('includes the remainder task text', () => {
    const prompt = buildHandoffPrompt({
      fromName: 'Sales Bot',
      fromJob: '',
      remainder: 'write the report',
      threadTail: '',
    })
    assert.match(prompt, /write the report/)
  })

  it('omits the Context section when threadTail is empty', () => {
    const prompt = buildHandoffPrompt({
      fromName: 'Sales Bot',
      fromJob: '',
      remainder: 'task',
      threadTail: '',
    })
    assert.doesNotMatch(prompt, /Context:/)
  })

  it('includes the Context section when threadTail is provided', () => {
    const prompt = buildHandoffPrompt({
      fromName: 'Sales Bot',
      fromJob: '',
      remainder: 'task',
      threadTail: 'user: do x\nassistant: did x',
    })
    assert.match(prompt, /Context:/)
    assert.match(prompt, /did x/)
  })

  it('omits the job from header when job is empty', () => {
    const prompt = buildHandoffPrompt({ fromName: 'Bot', fromJob: '', remainder: 'task', threadTail: '' })
    assert.doesNotMatch(prompt, / · $/)
  })
})
