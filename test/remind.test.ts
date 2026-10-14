import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCancelReminder, parseReminder, reminderLabel } from '../electron/remind'
import { nextDelayMs } from '../electron/scheduler'

describe('parseCancelReminder', () => {
  it('recognizes the phrases that cancel reminders', () => {
    for (const text of [
      'stop reminding me',
      'Stop reminding me please',
      'stop remind me',
      'cancel the reminders',
      'cancel reminder',
      'no more reminders',
      "don't remind me about this",
    ]) {
      assert.equal(parseCancelReminder(text), true, text)
    }
  })

  it('ignores ordinary text', () => {
    for (const text of ['summarize the meeting', 'remind me to stretch', '']) {
      assert.equal(parseCancelReminder(text), false, text)
    }
  })
})

describe('parseReminder', () => {
  it('reads a clock time with am/pm', () => {
    assert.deepEqual(parseReminder('remind me to reconcile ad spend at 9am'), {
      schedule: '09:00',
      task: 'reconcile ad spend',
    })
    assert.deepEqual(parseReminder('Remind me to stand up at 9:30pm'), {
      schedule: '21:30',
      task: 'stand up',
    })
  })

  it('handles the midnight and noon edges of am/pm', () => {
    assert.equal(parseReminder('remind me to water the plants at 12am')?.schedule, '00:00')
    assert.equal(parseReminder('remind me to eat lunch at 12pm')?.schedule, '12:00')
  })

  it('reads an interval', () => {
    assert.deepEqual(parseReminder('remind me to check the build every 2 hours'), {
      schedule: 'every 2 h',
      task: 'check the build',
    })
    assert.deepEqual(parseReminder('remind me every 30 minutes to check email'), {
      schedule: 'every 30 m',
      task: 'to check email',
    })
  })

  it('strips the "keep" prefix and the reminder preamble from the task', () => {
    assert.deepEqual(parseReminder('keep reminding me to stretch every 2 hours'), {
      schedule: 'every 2 h',
      task: 'stretch',
    })
  })

  it('cleans separators and dangling connectives from the task', () => {
    assert.deepEqual(parseReminder('remind me = drink water in every 1 min'), {
      schedule: 'every 1 m',
      task: 'drink water',
    })
    assert.deepEqual(parseReminder('remind me: call mom at 9am'), { schedule: '09:00', task: 'call mom' })
  })

  it('falls back to a placeholder when no task was given', () => {
    assert.deepEqual(parseReminder('remind me at 7am'), { schedule: '07:00', task: 'this' })
  })

  it('normalizes case and whitespace', () => {
    assert.deepEqual(parseReminder('REMIND ME TO STAND UP AT 9AM'), { schedule: '09:00', task: 'STAND UP' })
    assert.deepEqual(parseReminder('remind   me   to   sleep   at 10pm'), { schedule: '22:00', task: 'sleep' })
  })

  it('only produces schedules the scheduler accepts', () => {
    const prompts = [
      'remind me to reconcile ad spend at 9am',
      'remind me to check the build every 2 hours',
      'remind me every 30 minutes to check email',
      'keep reminding me to stretch every 2 hours',
      'remind me at 7am',
    ]
    for (const prompt of prompts) {
      const parsed = parseReminder(prompt)
      assert.ok(parsed, `expected ${prompt} to parse`)
      assert.notEqual(nextDelayMs(parsed.schedule), null, `${prompt} → ${parsed.schedule}`)
    }
  })

  it('returns null for anything that is not a reminder', () => {
    for (const text of [
      'summarize the meeting notes',
      'every 30 minutes',
      'stop reminding me',
      'what is a reminder?',
      '',
    ]) {
      assert.equal(parseReminder(text), null, text)
    }
  })

  it('returns null for a schedule it cannot honor', () => {
    // seconds are not a supported unit, and 25:00 is not a time
    assert.equal(parseReminder('remind me to breathe every 30 s'), null)
    assert.equal(parseReminder('remind me to pay rent at 25:00'), null)
    assert.equal(parseReminder('remind me to blink every 0 minutes'), null)
  })
})

describe('reminderLabel', () => {
  it('describes intervals in words', () => {
    assert.equal(reminderLabel('every 1 m'), 'every minute')
    assert.equal(reminderLabel('every 30 m'), 'every 30 minutes')
    assert.equal(reminderLabel('every 1 h'), 'every 1 hour')
    assert.equal(reminderLabel('every 2 h'), 'every 2 hours')
  })

  it('describes a clock time as daily', () => {
    assert.equal(reminderLabel('09:00'), 'daily at 09:00')
  })
})
