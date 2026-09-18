export interface TelegramMessage {
  id: number
  date: number
  sender: string
  text: string
  kind: string
  outgoing: boolean
  mediaPath?: string
}

export interface TelegramChat {
  id: string
  title: string
  kind: string
  lastMessageAt: number
  unreadCount: number
  messageCount: number
  complete: boolean
}

export interface TelegramSource {
  id: string
  label: string
  kind: 'account' | 'import'
  chats: TelegramChat[]
}

export interface TelegramContactChat {
  id: string
  title: string
}

export interface TelegramContact {
  id: string
  name: string
  messageCount: number
  lastActiveAt: number
  chatCount: number
  chats: TelegramContactChat[]
  outgoing: boolean
}

export interface TelegramResource {
  id: string
  messageId: number
  chatId: string
  chatTitle: string
  kind: string
  date: number
  sender: string
  mediaPath?: string
}

export interface TelegramStatus {
  connected: boolean
  accountName: string
  hasSavedSession: boolean
  secureStorage: boolean
  syncing: boolean
}

export type TelegramAuthStep = 'code' | 'password' | 'email' | 'emailCode'

export interface TelegramProgress {
  chat: string
  completed: number
  total: number
}

export interface TelegramSyncRange {
  from?: string
  to?: string
}
