import type { TelegramChat, TelegramMessage } from '../../shared/telegram'

type ExportText = string | Array<string | { text?: string }> | undefined
type ExportMessage = {
  id?: number
  type?: string
  date?: string
  date_unixtime?: string
  from?: string
  from_id?: string
  text?: ExportText
  media_type?: string
  file?: string
  photo?: string
  thumbnail?: string
}
type ExportChat = {
  id?: number | string
  name?: string
  type?: string
  messages?: ExportMessage[]
}

function textContent(value: ExportText): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')).join('')
}

export function parseTelegramExport(data: unknown, ownName = '', ownId = ''): Array<{ chat: TelegramChat; messages: TelegramMessage[] }> {
  if (!data || typeof data !== 'object') throw new Error('不是 Telegram Desktop JSON 导出文件')
  const root = data as ExportChat & { chats?: { list?: ExportChat[] }; left_chats?: { list?: ExportChat[] } }
  const lists = [root.chats?.list, root.left_chats?.list].filter((value): value is ExportChat[] => Array.isArray(value))
  if (!lists.length && Array.isArray(root.messages)) lists.push([root])
  if (!lists.length) throw new Error('缺少 chats.list 或 messages，请选择 Telegram Desktop 的 JSON 导出文件')

  return lists.flat().map((item, index) => {
    const title = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `会话 ${index + 1}`
    const messages: TelegramMessage[] = (Array.isArray(item.messages) ? item.messages : [])
      .filter(message => message && typeof message.id === 'number')
      .map(message => {
        const unix = Number(message.date_unixtime)
        const fallback = Date.parse(message.date || '') / 1000
        const date = Number.isFinite(unix) && unix > 0 ? unix : (Number.isFinite(fallback) ? fallback : 0)
        const mediaPath = [message.file, message.photo].find(path => typeof path === 'string' && path.length > 0)
        return {
          id: message.id!,
          date,
          sender: typeof message.from === 'string' ? message.from : '',
          text: textContent(message.text),
          kind: message.media_type || (message.photo ? 'photo' : message.type === 'service' ? 'service' : 'text'),
          outgoing: Boolean((ownName && message.from === ownName) || (ownId && message.from_id === `user${ownId}`)),
          ...(mediaPath ? { mediaPath } : {})
        }
      }).sort((a, b) => a.date - b.date || a.id - b.id)
    return {
      chat: {
        id: `${item.type || 'chat'}:${item.id ?? index}`,
        title,
        kind: item.type || 'personal_chat',
        lastMessageAt: messages.at(-1)?.date || 0,
        unreadCount: 0,
        messageCount: messages.length,
        complete: true
      },
      messages
    }
  })
}
