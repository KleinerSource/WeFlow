import type { TelegramChat, TelegramMessage, TelegramSource } from '../../shared/telegram'

type ChatLabSessionType = 'group' | 'private' | 'channel' | 'other'

export function telegramSessionType(kind: string): ChatLabSessionType {
  if (kind === 'channel' || kind === 'public_channel') return 'channel'
  if (kind === 'group' || kind === 'private_group' || kind === 'public_group' || kind === 'supergroup') return 'group'
  if (kind === 'personal_chat' || kind === 'private_chat') return 'private'
  return 'other'
}

export function listTelegramSessions(source: TelegramSource, keyword: string, limit: number, chatlab: boolean) {
  const query = keyword.toLocaleLowerCase()
  const chats = source.chats.filter(chat =>
    chat.id.toLocaleLowerCase().includes(query) || chat.title.toLocaleLowerCase().includes(query)
  ).slice(0, limit)
  if (chatlab) {
    return { sessions: chats.map(chat => ({
      id: chat.id,
      name: chat.title,
      platform: 'telegram',
      type: telegramSessionType(chat.kind),
      messageCount: chat.messageCount,
      lastMessageAt: chat.lastMessageAt,
      complete: chat.complete
    })) }
  }
  return { success: true, sourceId: source.id, count: chats.length, sessions: chats }
}

export function pageTelegramMessages(
  messages: TelegramMessage[],
  options: { start: number; end: number; keyword?: string; offset: number; limit: number; ascending: boolean }
) {
  const query = options.keyword?.toLocaleLowerCase() || ''
  const filtered = messages.filter(message =>
    (!options.start || message.date >= options.start)
    && (!options.end || message.date <= options.end)
    && (!query || message.text.toLocaleLowerCase().includes(query))
  )
  const ordered = options.ascending ? filtered : filtered.reverse()
  const page = ordered.slice(options.offset, options.offset + options.limit)
  return { messages: page, hasMore: options.offset + page.length < ordered.length }
}

function chatLabMessageType(kind: string): number {
  if (kind === 'text') return 0
  if (kind === 'photo') return 1
  if (kind === 'audio' || kind === 'audio_file' || kind === 'voice_message') return 2
  if (kind === 'video' || kind === 'video_file' || kind === 'animation') return 3
  if (kind === 'file' || kind === 'document') return 4
  if (kind === 'sticker') return 5
  if (kind === 'service') return 80
  return 99
}

export function toTelegramChatLab(source: TelegramSource, chat: TelegramChat, messages: TelegramMessage[]) {
  const senderName = (message: TelegramMessage) => message.sender || (message.outgoing ? source.label : '未知')
  const members = [...new Set(messages.map(senderName))].map(name => ({ platformId: name, accountName: name }))
  const type = telegramSessionType(chat.kind)
  return {
    chatlab: { version: '0.0.2', exportedAt: Math.floor(Date.now() / 1000), generator: 'WeFlow' },
    meta: {
      name: chat.title,
      platform: 'telegram',
      type,
      groupId: type === 'group' ? chat.id : undefined
    },
    members,
    messages: messages.map(message => ({
      sender: senderName(message),
      accountName: senderName(message),
      timestamp: message.date,
      type: chatLabMessageType(message.kind),
      content: message.text || (message.kind === 'text' ? null : `[${message.kind}]`),
      platformMessageId: String(message.id)
    }))
  }
}

export function publicTelegramMessages(messages: TelegramMessage[]) {
  return messages.map(({ mediaPath: _mediaPath, ...message }) => message)
}
