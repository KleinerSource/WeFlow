import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { TelegramChat, TelegramContact, TelegramMessage, TelegramResource, TelegramSource } from '../../shared/telegram'

export class TelegramStore {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly root: string

  constructor(root: string) { this.root = root }

  private directory(id: string): string {
    if (id !== 'live' && !/^import-[a-f0-9-]{36}$/.test(id)) throw new Error('无效的数据源')
    return join(this.root, id)
  }

  private messageFile(sourceId: string, chatId: string): string {
    const hash = createHash('sha256').update(chatId).digest('hex')
    return join(this.directory(sourceId), `${hash}.json`)
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(value), 'utf8')
    await rename(temp, file)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }

  async getSource(id: string): Promise<TelegramSource | null> {
    try {
      return JSON.parse(await readFile(join(this.directory(id), 'index.json'), 'utf8')) as TelegramSource
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async listSources(): Promise<TelegramSource[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    const sources = await Promise.all(entries.filter(entry => entry.isDirectory() && (entry.name === 'live' || /^import-[a-f0-9-]{36}$/.test(entry.name)))
      .map(entry => this.getSource(entry.name)))
    return sources.filter((source): source is TelegramSource => source !== null)
  }

  async getMessages(sourceId: string, chatId: string): Promise<TelegramMessage[]> {
    const source = await this.getSource(sourceId)
    if (!source?.chats.some(chat => chat.id === chatId)) throw new Error('会话不存在')
    return this.readMessages(sourceId, chatId)
  }

  private async readMessages(sourceId: string, chatId: string): Promise<TelegramMessage[]> {
    try {
      return JSON.parse(await readFile(this.messageFile(sourceId, chatId), 'utf8')) as TelegramMessage[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async listContacts(sourceId: string): Promise<TelegramContact[]> {
    const source = await this.getSource(sourceId)
    if (!source) throw new Error('数据源不存在')
    const contacts = new Map<string, TelegramContact>()
    for (const chat of source.chats) {
      const messages = await this.readMessages(sourceId, chat.id)
      for (const message of messages) {
        const name = message.sender || (message.outgoing ? source.label : chat.title)
        if (!name) continue
        const contact = contacts.get(name) || {
          id: name,
          name,
          messageCount: 0,
          lastActiveAt: 0,
          chatCount: 0,
          chats: [],
          outgoing: false
        }
        contact.messageCount += 1
        contact.lastActiveAt = Math.max(contact.lastActiveAt, message.date)
        contact.outgoing = contact.outgoing || message.outgoing
        if (!contact.chats.some(item => item.id === chat.id)) {
          contact.chats.push({ id: chat.id, title: chat.title })
          contact.chatCount += 1
        }
        contacts.set(name, contact)
      }
    }
    return [...contacts.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.name.localeCompare(b.name))
  }

  async listResources(sourceId: string): Promise<TelegramResource[]> {
    const source = await this.getSource(sourceId)
    if (!source) throw new Error('数据源不存在')
    const resources: TelegramResource[] = []
    for (const chat of source.chats) {
      const messages = await this.readMessages(sourceId, chat.id)
      for (const message of messages) {
        if (message.kind === 'text' || message.kind === 'service') continue
        resources.push({
          id: `${sourceId}:${chat.id}:${message.id}`,
          messageId: message.id,
          chatId: chat.id,
          chatTitle: chat.title,
          kind: message.kind,
          date: message.date,
          sender: message.sender || (message.outgoing ? source.label : chat.title),
          mediaPath: message.mediaPath
        })
      }
    }
    return resources.sort((a, b) => b.date - a.date || b.messageId - a.messageId)
  }

  async updateLive(label: string, chats: TelegramChat[]): Promise<void> {
    await this.serialize(async () => {
      const previous = await this.getSource('live')
      const previousChats = new Map(previous?.chats.map(chat => [chat.id, chat]) || [])
      const merged = chats.map(chat => ({
        ...chat,
        messageCount: previousChats.get(chat.id)?.messageCount || 0,
        complete: previousChats.get(chat.id)?.complete || false
      }))
      for (const chat of previous?.chats || []) {
        if (!chats.some(item => item.id === chat.id)) merged.push(chat)
      }
      await this.writeJson(join(this.directory('live'), 'index.json'), { id: 'live', kind: 'account', label, chats: merged })
    })
  }

  async upsertMessages(sourceId: string, chatId: string, messages: TelegramMessage[], complete = false): Promise<void> {
    await this.serialize(async () => {
      const source = await this.getSource(sourceId)
      const chat = source?.chats.find(item => item.id === chatId)
      if (!source || !chat) throw new Error('会话不存在')
      const existing = await this.getMessages(sourceId, chatId)
      const merged = new Map(existing.map(message => [message.id, message]))
      for (const message of messages) {
        const previous = merged.get(message.id)
        merged.set(message.id, { ...message, mediaPath: message.mediaPath || previous?.mediaPath })
      }
      const sorted = [...merged.values()].sort((a, b) => a.date - b.date || a.id - b.id)
      chat.messageCount = sorted.length
      chat.lastMessageAt = Math.max(chat.lastMessageAt, sorted.at(-1)?.date || 0)
      chat.complete = chat.complete || complete
      await this.writeJson(this.messageFile(sourceId, chatId), sorted)
      await this.writeJson(join(this.directory(sourceId), 'index.json'), source)
    })
  }

  async removeMessages(sourceId: string, chatId: string, ids: number[]): Promise<void> {
    await this.serialize(async () => {
      const source = await this.getSource(sourceId)
      const chat = source?.chats.find(item => item.id === chatId)
      if (!source || !chat) return
      const existing = await this.getMessages(sourceId, chatId)
      const removed = new Set(ids)
      const remaining = existing.filter(message => !removed.has(message.id))
      if (remaining.length === existing.length) return
      chat.messageCount = remaining.length
      chat.lastMessageAt = remaining.at(-1)?.date || 0
      await this.writeJson(this.messageFile(sourceId, chatId), remaining)
      await this.writeJson(join(this.directory(sourceId), 'index.json'), source)
    })
  }

  async importExport(label: string, baseDirectory: string, data: Array<{ chat: TelegramChat; messages: TelegramMessage[] }>): Promise<string> {
    const id = `import-${randomUUID()}`
    const chats = data.map(item => item.chat)
    for (const { chat, messages } of data) {
      const normalized = messages.map(message => {
        const media = message.mediaPath
        if (!media || isAbsolute(media)) return { ...message, mediaPath: undefined }
        const absolute = resolve(baseDirectory, media)
        const rel = relative(baseDirectory, absolute)
        return { ...message, mediaPath: rel.startsWith('..') || isAbsolute(rel) ? undefined : absolute }
      })
      await this.writeJson(this.messageFile(id, chat.id), normalized)
    }
    await this.writeJson(join(this.directory(id), 'index.json'), { id, label, kind: 'import', chats })
    return id
  }

  async removeImport(id: string): Promise<void> {
    const source = await this.getSource(id)
    const target = this.directory(id)
    if (!source || source.kind !== 'import' || relative(this.root, target) !== id) throw new Error('只能移除已导入的数据源')
    const [rootPath, targetPath] = await Promise.all([realpath(this.root), realpath(target)])
    if (relative(rootPath, targetPath) !== id) throw new Error('数据源目录不在存储路径内')
    await this.serialize(() => rm(target, { recursive: true }))
  }
}
