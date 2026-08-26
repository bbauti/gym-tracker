import { expect, test } from 'bun:test'
import { bestsOf, detectPrs, e1rmG, type SetFacts } from './prs'

const set = (weightG: number | null, reps: number | null, kind = 'normal'): SetFacts => ({
  kind,
  reps,
  weightG,
})
const bests = (history: SetFacts[]) => bestsOf(history, 'epley')
const prs = (s: SetFacts, history: SetFacts[]) => detectPrs(s, bests(history), 'epley')

test('the first working set of an exercise is a record in everything but reps', () => {
  // Nothing to compare the reps against yet: 8 reps at 60 kg is not "more than ever at 60 kg".
  expect(prs(set(60_000, 8), [])).toEqual(['weight', 'volume', 'e1rm'])
})

test('only a strict improvement is a record', () => {
  const history = [set(60_000, 8)]
  expect(prs(set(60_000, 8), history)).toEqual([])
  expect(prs(set(59_999, 8), history)).toEqual([])
  expect(prs(set(60_001, 8), history)).toEqual(['weight', 'volume', 'e1rm'])
})

test('warm-ups never make a record and never raise the bar', () => {
  expect(prs(set(200_000, 5, 'warmup'), [])).toEqual([])

  // A 200 kg warm-up in the history cannot stop the 60 kg working set from being the first record.
  const history = [set(200_000, 5, 'warmup')]
  expect(bests(history)).toEqual({
    e1rmG: 0,
    repsAtWeight: new Map(),
    volumeG: 0,
    weightG: 0,
  })
  expect(prs(set(60_000, 8), history)).toEqual(['weight', 'volume', 'e1rm'])
})

test('more reps at a weight already in the history is a record, the first time at it is not', () => {
  const history = [set(80_000, 5), set(60_000, 10)]
  expect(prs(set(80_000, 6), history)).toEqual(['reps_at_weight', 'e1rm'])
  expect(prs(set(80_000, 5), history)).toEqual([])
  expect(prs(set(80_000, 4), history)).toEqual([])
  // 70 kg was never lifted, so there is no rep count to beat at 70 kg — the other columns still move.
  expect(prs(set(70_000, 20), history)).toEqual(['volume', 'e1rm'])
})

test('bodyweight reps are a record at zero, with null and 0 the same weight', () => {
  expect(prs(set(null, 10), [])).toEqual([])
  expect(prs(set(null, 12), [set(null, 10)])).toEqual(['reps_at_weight'])
  expect(prs(set(0, 12), [set(null, 10)])).toEqual(['reps_at_weight'])
  expect(prs(set(null, 10), [set(0, 12)])).toEqual([])
})

test('a row with nothing typed into it is not a result', () => {
  expect(prs(set(100_000, null), [])).toEqual([])
  expect(prs(set(100_000, 0), [])).toEqual([])
  expect(prs(set(null, null), [])).toEqual([])
  expect(bests([set(100_000, null), set(100_000, 0)])).toEqual({
    e1rmG: 0,
    repsAtWeight: new Map(),
    volumeG: 0,
    weightG: 0,
  })
})

test('weight, set volume and estimated 1RM move on their own', () => {
  const history = [set(80_000, 8)] // 640 kg de volumen, 101,33 kg de 1RM estimado
  // Heavier but shorter: the volume record survives.
  expect(prs(set(100_000, 3), history)).toEqual(['weight', 'e1rm'])
  // Lighter but longer: only the volume record falls.
  expect(prs(set(60_000, 12), history)).toEqual(['volume'])
  expect(prs(set(85_000, 8), history)).toEqual(['weight', 'volume', 'e1rm'])
})

test('bestsOf keeps the best of each column, not the best set', () => {
  const b = bests([set(60_000, 10), set(80_000, 5), set(80_000, 3), set(300_000, 1, 'warmup')])
  expect(b.weightG).toBe(80_000)
  expect(b.volumeG).toBe(600_000)
  expect(b.e1rmG).toBe(93_333)
  expect(b.repsAtWeight.get(80_000)).toBe(5)
  expect(b.repsAtWeight.get(60_000)).toBe(10)
  expect(b.repsAtWeight.has(300_000)).toBe(false)
})

test('epley rounds to whole grams', () => {
  // w × (1 + reps/30) literal: a single rep is 3,33 % over the bar, not the bar itself.
  expect(e1rmG(100_000, 1, 'epley')).toBe(103_333)
  expect(e1rmG(100_000, 10, 'epley')).toBe(133_333)
  expect(e1rmG(62_500, 7, 'epley')).toBe(77_083)
  expect(Number.isInteger(e1rmG(62_500, 7, 'epley'))).toBe(true)
})

test('an unknown formula throws instead of quietly switching to epley', () => {
  expect(() => e1rmG(100_000, 5, 'brzycki')).toThrow('unknown e1rm formula: brzycki')
  expect(() => bestsOf([set(100_000, 5)], 'lombardi')).toThrow('unknown e1rm formula: lombardi')
  expect(() => detectPrs(set(100_000, 5), bests([]), 'oconner')).toThrow('unknown e1rm formula')
  expect(() => e1rmG(100_000, 0, 'epley')).toThrow('e1rm needs reps >= 1')
})
