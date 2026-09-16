import type { TelegramSyncRange } from '../../shared/telegram'

type SyncBounds = { from?: number; until?: number }

function startOfDay(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('请输入有效日期')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (year < 1970 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('请输入有效日期')
  }
  return date
}

export function parseTelegramSyncRange(range: TelegramSyncRange = {}): SyncBounds {
  const fromDate = startOfDay(range.from)
  const toDate = startOfDay(range.to)
  if (fromDate && toDate && fromDate > toDate) throw new Error('起始日期不能晚于截止日期')
  if (toDate) toDate.setDate(toDate.getDate() + 1)
  return {
    ...(fromDate ? { from: Math.floor(fromDate.getTime() / 1000) } : {}),
    ...(toDate ? { until: Math.floor(toDate.getTime() / 1000) } : {})
  }
}

export function selectTelegramSyncBatch<T extends { date: number }>(messages: T[], bounds: SyncBounds, exhausted: boolean) {
  const pastStart = bounds.from !== undefined && messages.some(message => message.date < bounds.from!)
  return {
    messages: messages.filter(message =>
      (bounds.from === undefined || message.date >= bounds.from)
      && (bounds.until === undefined || message.date < bounds.until)),
    stop: exhausted || pastStart,
    complete: exhausted && bounds.from === undefined && bounds.until === undefined
  }
}
