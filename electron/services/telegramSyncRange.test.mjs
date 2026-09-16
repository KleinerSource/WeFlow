import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTelegramSyncRange, selectTelegramSyncBatch } from './telegramSyncRange.ts'

test('历史同步日期包含起止日，并拒绝无效或倒序日期', () => {
  const range = parseTelegramSyncRange({ from: '2026-09-01', to: '2026-09-03' })
  assert.equal(range.from, new Date(2026, 8, 1).getTime() / 1000)
  assert.equal(range.until, new Date(2026, 8, 4).getTime() / 1000)
  assert.deepEqual(parseTelegramSyncRange(), {})
  assert.throws(() => parseTelegramSyncRange({ from: '2026-02-30' }), /日期/)
  assert.throws(() => parseTelegramSyncRange({ from: '2026-09-04', to: '2026-09-03' }), /起始日期/)
})

test('频道消息在范围内保留，跨过起始日后停止且不标记完整历史', () => {
  const range = parseTelegramSyncRange({ from: '2026-09-01', to: '2026-09-03' })
  const dates = [new Date(2026, 8, 4), new Date(2026, 8, 3), new Date(2026, 8, 1), new Date(2026, 7, 31)]
  const batch = dates.map((date, id) => ({ id, date: date.getTime() / 1000 }))
  const selected = selectTelegramSyncBatch(batch, range, false)
  assert.deepEqual(selected.messages.map(item => item.id), [1, 2])
  assert.equal(selected.stop, true)
  assert.equal(selected.complete, false)
  assert.equal(selectTelegramSyncBatch(batch.slice(0, 2), parseTelegramSyncRange(), true).complete, true)
  assert.equal(selectTelegramSyncBatch(batch.slice(0, 2), parseTelegramSyncRange({ from: '2026-09-01' }), true).complete, false)
  const onlyEnd = selectTelegramSyncBatch(batch, parseTelegramSyncRange({ to: '2026-09-03' }), true)
  assert.deepEqual(onlyEnd.messages.map(item => item.id), [1, 2, 3])
  assert.equal(onlyEnd.complete, false)
})
