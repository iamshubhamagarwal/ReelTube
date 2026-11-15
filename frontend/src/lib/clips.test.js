// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configProblem, defaultConfig, detectPlatform, estimateSize, findOverlaps, parseClipLine, parseClipLines,
  splitLinks, toPayload, totalLength, validateClip,
} from './clips.js'

test('parseClipLine: separators, names, formats', () => {
  const cases = [
    ['34:33 - 36:43', 2073, 2203, ''],
    ['34:33-36:43', 2073, 2203, ''],
    ['1:02:10 - 1:03:00 Intro part', 3730, 3780, 'Intro part'],
    ['02:10 to 03:45', 130, 225, ''],
    ['2:10 TO 3:45 Chorus', 130, 225, 'Chorus'],
    ['2:10 – 3:45', 130, 225, ''],
    ['2:10—3:45 Bridge', 130, 225, 'Bridge'],
    ['1:12:05 - 1:14:30', 4325, 4470, ''],
    ['34:33 - 36:43 - Best bit', 2073, 2203, 'Best bit'],
    ['34:33 - 36:43: Best bit', 2073, 2203, 'Best bit'],
    ['  - 0:10 - 0:20 bullet  ', 10, 20, 'bullet'],
    ['1. 0:10 - 0:20 numbered', 10, 20, 'numbered'],
    ['10 - 20', 10, 20, ''],
    ['0:05.5 - 0:07.25 fractions', 5.5, 7.25, 'fractions'],
    ['1:00 - 2:00 5 tips for 2025', 60, 120, '5 tips for 2025'],
  ]
  for (const [line, start, end, name] of cases) {
    assert.deepEqual(parseClipLine(line), { start, end, name }, line)
  }
})

test('parseClipLine: blank and invalid lines', () => {
  assert.equal(parseClipLine('   '), null)
  for (const bad of ['hello', '34:33', '34:33 36:43', '34:33 ~ 36:43', '1:75 - 2:00']) {
    assert.throws(() => parseClipLine(bad), undefined, bad)
  }
})

test('parseClipLines: keeps good lines, reports bad ones with line numbers', () => {
  const { clips, errors } = parseClipLines('34:33 - 36:43\n\n1:02:10 - 1:03:00 Intro part\nnot a clip\r\n2:10 to 3:45')
  assert.deepEqual(clips.map((c) => [c.start, c.end, c.name]), [[2073, 2203, ''], [3730, 3780, 'Intro part'], [130, 225, '']])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^Line 4:/)
})

test('validateClip', () => {
  const D = 600
  for (const [s, e] of [[0, 10], [130, 225], [590, 600], [599.5, 600.5]]) assert.equal(validateClip(s, e, D), null)
  const bad = [
    [null, 10, 'both'], [10, null, 'both'], [NaN, 10, 'look like'], [20, 10, 'after start'], [10, 10, 'after start'],
    [-1, 10, 'negative'], [600, 610, 'past the end'], [500, 700, 'past the end'], [10, 10.2, 'at least'],
  ]
  for (const [s, e, fragment] of bad) assert.match(validateClip(s, e, D), new RegExp(fragment), `${s}-${e}`)
  // Unknown duration (some Instagram videos): only ordering rules apply.
  assert.equal(validateClip(100, 5000, 0), null)
})

test('findOverlaps and totalLength', () => {
  const clips = [
    { start: 0, end: 10 }, { start: 5, end: 15 }, { start: 15, end: 20 },
    { start: 30, end: 40 }, { start: 32, end: 35 }, { start: NaN, end: 3 },
  ]
  assert.deepEqual(findOverlaps(clips), [[0, 1], [3, 4]])
  assert.equal(totalLength(clips), 10 + 10 + 5 + 10 + 3)
})

test('detectPlatform and splitLinks', () => {
  assert.equal(detectPlatform('https://youtu.be/abc'), 'youtube')
  assert.equal(detectPlatform('m.youtube.com/watch?v=x'), 'youtube')
  assert.equal(detectPlatform('https://www.instagram.com/reel/abc/'), 'instagram')
  assert.equal(detectPlatform('https://example.com'), null)
  assert.deepEqual(
    splitLinks('https://youtu.be/a\nhttps://www.instagram.com/p/b/ junk, https://youtube.com/shorts/c'),
    ['https://youtu.be/a', 'https://www.instagram.com/p/b/', 'https://youtube.com/shorts/c'],
  )
})

test('toPayload and configProblem', () => {
  const info = { url: 'u', platform: 'youtube', duration: 600, qualities: [{ height: 720 }, { height: 1080 }], is_video: true }
  const config = defaultConfig(info)
  assert.equal(config.quality, 720)
  assert.deepEqual(toPayload(info, config), { url: 'u', type: 'video', quality: 720, bitrate: 192 })

  config.clipsOn = true
  config.clips = [
    { start: 10, end: 20, name: 'A', override: 'audio:320' },
    { start: 30, end: 25, name: '', override: '' },
  ]
  assert.match(configProblem(info, config), /^Clip 2:/)
  config.clips[1].end = 40
  assert.equal(configProblem(info, config), null)
  const p = toPayload(info, config)
  assert.deepEqual(p.clips[0], { start: 10, end: 20, name: 'A', type: 'audio', bitrate: 320 })
  assert.equal(p.output, 'separate')
  config.output = 'merged'
  config.fade = true
  const merged = toPayload(info, config)
  assert.equal(merged.fade, true)
  assert.equal(merged.clips[0].type, undefined) // overrides ignored when merged
})

test('estimateSize scales with clip length', () => {
  const info = { duration: 100, qualities: [{ height: 720, filesize: 1000 }] }
  const base = { type: 'video', quality: 720, bitrate: 128, clipsOn: false, clips: [] }
  assert.equal(estimateSize(info, base), 1000)
  assert.equal(estimateSize(info, { ...base, clipsOn: true, clips: [{ start: 0, end: 10 }, { start: 50, end: 60 }] }), 200)
  assert.equal(estimateSize(info, { ...base, type: 'audio' }), 16000 * 100)
  assert.equal(estimateSize(info, { ...base, quality: 1080 }), null)
  assert.equal(estimateSize({ duration: 0 }, base), null)
})
