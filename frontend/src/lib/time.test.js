// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, formatTime, parseTime } from './time.js'

test('parseTime accepts SS, MM:SS, HH:MM:SS and fractions', () => {
  const cases = {
    '0': 0, '45': 45, '90': 90, '2:10': 130, '02:10': 130, '34:33': 2073, '36:43': 2203,
    '1:02:03': 3723, '01:02:03': 3723, '1:12:05': 4325, '10:00:00': 36000,
    '34:33.5': 2073.5, '1:02:03.25': 3723.25, '  3:45  ': 225, '120:00': 7200,
  }
  for (const [text, seconds] of Object.entries(cases)) {
    assert.equal(parseTime(text), seconds, text)
  }
})

test('parseTime returns null for empty input', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(parseTime(v), null)
})

test('parseTime returns NaN for invalid input', () => {
  for (const bad of ['abc', '1:2:3:4', '34:75', '1:75:00', '1:00:60', '-5', '1:', ':30', '1::30', '1.2.3', '12m30s']) {
    assert.ok(Number.isNaN(parseTime(bad)), bad)
  }
})

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(130), '2:10')
  assert.equal(formatTime(2073), '34:33')
  assert.equal(formatTime(3723.4), '1:02:03.4')
  assert.equal(formatTime(3723.4, { tenths: false }), '1:02:03')
  assert.equal(formatTime(null), '')
})

test('round trip parse(format(x)) for tenths', () => {
  for (const x of [0, 5.5, 59.9, 60, 2073.3, 3599.9, 3723.1, 36000]) {
    assert.equal(parseTime(formatTime(x)), x)
  }
})

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536000), '1.5 MB')
  assert.equal(formatBytes(null), '?')
})
