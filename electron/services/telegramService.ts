import { app, BrowserWindow, safeStorage } from 'electron'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { createHash } from 'crypto'
import { TelegramClient, Api } from 'teleproto'
import { StringSession } from 'teleproto/sessions'
import { NewMessage, EditedMessage, DeletedMessage } from 'teleproto/events'
import type { TelegramAuthStep, TelegramChat, TelegramMessage, TelegramProgress, TelegramStatus, TelegramSyncRange } from '../../shared/telegram'
import { parseTelegramExport } from './telegramExport'
import { TelegramStore } from './telegramStore'
import { canPersistTelegramSession } from './telegramStorage'
import { parseTelegramSyncRange, selectTelegramSyncBatch } from './telegramSyncRange'

type Credentials = { apiId: number; apiHash: string; session: string }

class TelegramService {
  private dataStore: TelegramStore | null = null
  private get dataRoot(): string {
    return join(String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || app.getPath('userData')), 'telegram')
  }
  private get store(): TelegramStore {
    return this.dataStore ??= new TelegramStore(this.dataRoot)
  }
  private client: TelegramClient | null = null
  private peers = new Map<string, Api.TypeInputPeer>()
  private ownName = ''
  private authPending: { step: TelegramAuthStep; resolve: (value: string) => void; reject: (error: Error) => void } | null = null
  private restoreTask: Promise<boolean> | null = null
  private connecting = false
  private syncing = false
  private stopSync = false

  private get authPath(): string { return join(this.dataRoot, 'auth.enc') }

  private emit(channel: string, value?: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, value)
    }
  }

  private get secureStorage(): boolean {
    return canPersistTelegramSession(safeStorage)
  }

  private async readCredentials(): Promise<Credentials | null> {
    if (!this.secureStorage) return null
    try {
      const encrypted = await readFile(this.authPath)
      return JSON.parse(safeStorage.decryptString(encrypted)) as Credentials
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Telegram 会话无法解密，请重新登录')
    }
  }

  private async saveCredentials(credentials: Credentials): Promise<void> {
    if (!this.secureStorage) return
    await mkdir(dirname(this.authPath), { recursive: true })
    await writeFile(this.authPath, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 })
  }

  async status(): Promise<TelegramStatus> {
    const hasSavedSession = this.secureStorage && await stat(this.authPath).then(() => true, () => false)
    return { connected: Boolean(this.client), accountName: this.ownName, hasSavedSession, secureStorage: this.secureStorage, syncing: this.syncing }
  }

  private prompt(step: TelegramAuthStep): Promise<string> {
    if (this.authPending) throw new Error('已有待处理的验证步骤')
    this.emit('telegram:auth-step', step)
    return new Promise<string>((resolve, reject) => { this.authPending = { step, resolve, reject } })
  }

  submitAuth(step: TelegramAuthStep, value: string): void {
    const pending = this.authPending
    if (!pending || pending.step !== step) throw new Error('验证步骤已失效')
    if (!value.trim()) throw new Error('请输入验证内容')
    this.authPending = null
    pending.resolve(value.trim())
  }

  cancelAuth(): void {
    this.authPending?.reject(new Error('已取消登录'))
    this.authPending = null
  }

  private normalizeMessage(message: Api.Message): TelegramMessage | null {
    if (!message || !('id' in message) || !('date' in message)) return null
    const media = 'media' in message ? message.media : undefined
    const document = media instanceof Api.MessageMediaDocument ? media.document : undefined
    const kind = media instanceof Api.MessageMediaPhoto ? 'photo'
      : document instanceof Api.Document && document.attributes.some(attribute => attribute instanceof Api.DocumentAttributeVideo) ? 'video'
        : document instanceof Api.Document && document.attributes.some(attribute => attribute instanceof Api.DocumentAttributeAudio) ? 'audio'
          : media instanceof Api.MessageMediaDocument ? 'file'
        : message instanceof Api.MessageService ? 'service' : 'text'
    const outgoing = 'out' in message && Boolean(message.out)
    const sender = 'sender' in message ? message.sender : undefined
    const senderName = sender instanceof Api.User ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username || ''
      : sender instanceof Api.Chat || sender instanceof Api.Channel ? sender.title : ''
    return {
      id: message.id,
      date: message.date,
      sender: outgoing ? this.ownName : senderName || (message.fromId ? String('userId' in message.fromId ? message.fromId.userId : 'channelId' in message.fromId ? message.fromId.channelId : 'chatId' in message.fromId ? message.fromId.chatId : '') : ''),
      text: 'message' in message && typeof message.message === 'string' ? message.message : '',
      kind,
      outgoing
    }
  }

  private registerEvents(client: TelegramClient): void {
    const receive = (message: Api.Message) => {
      void (async () => {
        if (!message.peerId) return
        const id = await client.getPeerId(message.peerId)
        if (!this.peers.has(id)) await this.refreshDialogs()
        const normalized = this.normalizeMessage(message)
        if (normalized && await this.store.getSource('live')) {
          await this.store.upsertMessages('live', id, [normalized])
          this.emit('telegram:changed')
        }
      })().catch(error => console.error('[Telegram] 更新消息失败:', error))
    }
    client.addEventHandler(event => receive(event.message), new NewMessage({}))
    client.addEventHandler(event => receive(event.message), new EditedMessage({}))
    client.addEventHandler(event => {
      void (async () => {
        const source = await this.store.getSource('live')
        if (!source) return
        const ids = event.peer
          ? [await client.getPeerId(event.peer)]
          : source.chats.filter(chat => chat.kind !== 'channel').map(chat => chat.id)
        for (const id of ids) await this.store.removeMessages('live', id, event.deletedIds)
        this.emit('telegram:changed')
      })().catch(error => console.error('[Telegram] 删除消息同步失败:', error))
    }, new DeletedMessage({}))
  }

  private async activate(client: TelegramClient): Promise<void> {
    const me = await client.getMe()
    this.ownName = [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Telegram 用户'
    this.client = client
    this.registerEvents(client)
    await this.refreshDialogs()
    this.emit('telegram:changed')
  }

  restore(): Promise<boolean> {
    if (this.client) return Promise.resolve(true)
    if (this.restoreTask) return this.restoreTask
    if (this.connecting) return Promise.reject(new Error('正在连接 Telegram'))
    this.restoreTask = this.connectSavedSession().finally(() => { this.restoreTask = null })
    return this.restoreTask
  }

  private async connectSavedSession(): Promise<boolean> {
    this.connecting = true
    let client: TelegramClient | null = null
    try {
      const credentials = await this.readCredentials()
      if (!credentials) return false
      client = new TelegramClient(new StringSession(credentials.session), credentials.apiId, credentials.apiHash, { connectionRetries: 3 })
      await client.connect()
      if (!await client.isUserAuthorized()) throw new Error('Telegram 会话已失效，请重新登录')
      await this.activate(client)
      return true
    } catch (error) {
      if (client) await client.disconnect()
      if (this.client === client) this.client = null
      throw error
    } finally {
      this.connecting = false
    }
  }

  async login(apiId: number, apiHash: string, phone: string): Promise<void> {
    if (this.connecting || this.client) throw new Error('已有 Telegram 连接')
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash.trim() || !/^\+?\d{7,15}$/.test(phone.trim())) {
      throw new Error('请填写有效的 API ID、API Hash 和国际格式手机号')
    }
    this.connecting = true
    const client = new TelegramClient(new StringSession(''), apiId, apiHash.trim(), { connectionRetries: 3 })
    try {
      await client.start({
        phoneNumber: phone.trim(),
        phoneCode: () => this.prompt('code'),
        password: () => this.prompt('password'),
        emailAddress: () => this.prompt('email'),
        emailVerification: async () => ({ type: 'code', code: await this.prompt('emailCode') }),
        onError: error => {
          if (error.message === '已取消登录') throw error
          this.emit('telegram:auth-error', error.message)
        }
      })
      await this.activate(client)
      await this.saveCredentials({ apiId, apiHash: apiHash.trim(), session: client.session.save() as string })
    } catch (error) {
      this.cancelAuth()
      await client.disconnect()
      if (this.client === client) this.client = null
      throw error
    } finally {
      this.connecting = false
    }
  }

  async logout(): Promise<void> {
    this.stopSync = true
    this.cancelAuth()
    const client = this.client
    this.client = null
    this.peers.clear()
    this.ownName = ''
    await unlink(this.authPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    if (client) await client.logOut().catch(() => client.disconnect())
    this.emit('telegram:changed')
  }

  async shutdown(): Promise<void> {
    this.stopSync = true
    this.cancelAuth()
    const client = this.client
    this.client = null
    if (client) await client.disconnect()
  }

  async refreshDialogs(): Promise<void> {
    const client = this.client
    if (!client) throw new Error('请先登录 Telegram')
    const dialogs = await client.getDialogs({})
    const chats: TelegramChat[] = []
    for (const dialog of dialogs) {
      const id = await client.getPeerId(dialog.inputEntity)
      this.peers.set(id, dialog.inputEntity)
      chats.push({ id, title: dialog.name || dialog.title || id, kind: dialog.isChannel ? 'channel' : dialog.isGroup ? 'group' : 'personal_chat', lastMessageAt: dialog.date || 0, unreadCount: dialog.unreadCount, messageCount: 0, complete: false })
    }
    await this.store.updateLive(this.ownName, chats)
    this.emit('telegram:changed')
  }

  async loadMessages(chatId: string, older = false): Promise<TelegramMessage[]> {
    const client = this.client
    if (!client) throw new Error('请先登录 Telegram')
    const peer = this.peers.get(chatId)
    if (!peer) throw new Error('会话不可用，请刷新会话')
    const existing = await this.store.getMessages('live', chatId)
    let offsetId = older && existing.length ? Math.min(...existing.map(item => item.id)) : 0
    const newestCachedId = existing.length ? Math.max(...existing.map(item => item.id)) : 0
    do {
      const batch = await client.getMessages(peer, { limit: 100, offsetId })
      const messages = batch.map(item => this.normalizeMessage(item)).filter((item): item is TelegramMessage => Boolean(item))
      await this.store.upsertMessages('live', chatId, messages, batch.length < 100)
      if (older || batch.length < 100 || !newestCachedId || batch.some(item => item.id <= newestCachedId)) break
      const nextOffset = Math.min(...batch.map(item => item.id))
      if (!nextOffset || nextOffset >= offsetId && offsetId !== 0) break
      offsetId = nextOffset
    } while (true)
    this.emit('telegram:changed')
    return this.store.getMessages('live', chatId)
  }

  async downloadMedia(chatId: string, messageId: number): Promise<string> {
    const client = this.client
    const peer = this.peers.get(chatId)
    if (!client || !peer || !Number.isSafeInteger(messageId)) throw new Error('请先连接 Telegram 并选择有效消息')
    const existing = (await this.store.getMessages('live', chatId)).find(item => item.id === messageId)
    if (existing?.mediaPath && await stat(existing.mediaPath).then(() => true, () => false)) return existing.mediaPath
    const message = (await client.getMessages(peer, { ids: messageId }))[0]
    if (!message || !('media' in message) || !message.media) throw new Error('媒体已不可用')
    const directory = join(this.dataRoot, 'live', 'media', createHash('sha256').update(chatId).digest('hex'), String(messageId))
    await mkdir(directory, { recursive: true })
    const output = await client.downloadMedia(message, { outputFile: directory })
    if (typeof output !== 'string') throw new Error('媒体下载失败')
    const normalized = this.normalizeMessage(message)
    if (normalized) await this.store.upsertMessages('live', chatId, [{ ...normalized, mediaPath: output }])
    this.emit('telegram:changed')
    return output
  }

  async syncAll(range?: TelegramSyncRange): Promise<void> {
    if (!this.client) throw new Error('请先登录 Telegram')
    if (this.syncing) throw new Error('历史同步正在进行')
    const bounds = parseTelegramSyncRange(range)
    this.syncing = true
    this.stopSync = false
    try {
      await this.refreshDialogs()
      const chats = (await this.store.getSource('live'))?.chats || []
      for (let index = 0; index < chats.length && !this.stopSync; index++) {
        const chat = chats[index]
        const peer = this.peers.get(chat.id)
        if (!peer) continue
        let offsetId = 0
        while (!this.stopSync) {
          const batch = await this.client!.getMessages(peer, {
            limit: 100,
            offsetId,
            ...(offsetId === 0 && bounds.until !== undefined ? { offsetDate: bounds.until } : {})
          })
          const messages = batch.map(item => this.normalizeMessage(item)).filter((item): item is TelegramMessage => Boolean(item))
          const selected = selectTelegramSyncBatch(messages, bounds, batch.length < 100)
          if (selected.messages.length || selected.complete) await this.store.upsertMessages('live', chat.id, selected.messages, selected.complete)
          this.emit('telegram:changed')
          if (selected.stop) break
          offsetId = Math.min(...batch.map(item => item.id))
          if (!offsetId) break
        }
        this.emit('telegram:progress', { chat: chat.title, completed: index + 1, total: chats.length } satisfies TelegramProgress)
      }
    } finally {
      this.syncing = false
      this.emit('telegram:changed')
    }
  }

  cancelSync(): void { this.stopSync = true }

  async importJson(filePath: string): Promise<string> {
    if (!filePath.toLowerCase().endsWith('.json')) throw new Error('请选择 JSON 文件')
    const content = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    const ownName = typeof content === 'object' && content && 'personal_information' in content
      ? [String((content.personal_information as { first_name?: string }).first_name || ''), String((content.personal_information as { last_name?: string }).last_name || '')].filter(Boolean).join(' ') : ''
    const ownId = typeof content === 'object' && content && 'personal_information' in content
      ? String((content.personal_information as { user_id?: number | string }).user_id || '') : ''
    const data = parseTelegramExport(content, ownName, ownId)
    const id = await this.store.importExport(basename(filePath, '.json'), dirname(filePath), data)
    this.emit('telegram:changed')
    return id
  }

  getStore(): TelegramStore { return this.store }
}

export const telegramService = new TelegramService()
