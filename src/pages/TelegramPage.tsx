import { useEffect, useMemo, useState } from 'react'
import { Download, File, FileJson, FolderOpen, Image as ImageIcon, LogOut, MessageCircle, MessageSquare, Music, PlayCircle, RefreshCw, Search, Settings2, Trash2, Upload, User, Users, X } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import type { TelegramAuthStep, TelegramContact, TelegramMessage, TelegramProgress, TelegramResource, TelegramSource, TelegramStatus, TelegramSyncRange } from '../../shared/telegram'
import './TelegramPage.scss'

const api = window.electronAPI.telegram
type View = 'chat' | 'contacts' | 'resources' | 'export'
const authLabels: Record<TelegramAuthStep, string> = { code: 'Telegram 验证码', password: '两步验证密码', email: '验证邮箱', emailCode: '邮箱验证码' }

function dateLabel(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toLocaleString('zh-CN') : ''
}

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function resourceKindLabel(kind: string): string {
  if (['photo', 'image'].includes(kind)) return '图片'
  if (['video', 'video_file', 'animation'].includes(kind)) return '视频'
  if (['audio', 'audio_file', 'voice_message'].includes(kind)) return '音频'
  if (['file', 'document'].includes(kind)) return '文件'
  if (kind === 'sticker') return '贴纸'
  return kind
}

function ResourceKindIcon({ kind }: { kind: string }) {
  if (['photo', 'image'].includes(kind)) return <ImageIcon size={30} />
  if (['video', 'video_file', 'animation'].includes(kind)) return <PlayCircle size={30} />
  if (['audio', 'audio_file', 'voice_message'].includes(kind)) return <Music size={30} />
  if (kind === 'sticker') return <MessageCircle size={30} />
  return <File size={30} />
}

function TelegramPage() {
  const [sources, setSources] = useState<TelegramSource[]>([])
  const [status, setStatus] = useState<TelegramStatus>({ connected: false, accountName: '', hasSavedSession: false, secureStorage: true, syncing: false })
  const [sourceId, setSourceId] = useState('')
  const [chatId, setChatId] = useState('')
  const [view, setView] = useState<View>('chat')
  const [messages, setMessages] = useState<TelegramMessage[]>([])
  const [contacts, setContacts] = useState<TelegramContact[]>([])
  const [resources, setResources] = useState<TelegramResource[]>([])
  const [selectedContactId, setSelectedContactId] = useState('')
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [progress, setProgress] = useState<TelegramProgress | null>(null)
  const [syncPeriod, setSyncPeriod] = useState<'all' | '7' | '30' | '90' | 'custom'>('all')
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')
  const [showConnection, setShowConnection] = useState(false)
  const [authStep, setAuthStep] = useState<TelegramAuthStep | null>(null)
  const [authInput, setAuthInput] = useState('')
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [format, setFormat] = useState<'json' | 'csv' | 'md'>('json')

  useEffect(() => {
    const removeChanged = api.onChanged(() => setRevision(value => value + 1))
    const removeAuth = api.onAuthStep(step => { setAuthStep(step); setAuthInput('') })
    const removeAuthError = api.onAuthError(setError)
    const removeProgress = api.onProgress(setProgress)
    return () => { removeChanged(); removeAuth(); removeAuthError(); removeProgress() }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.sources(), api.status()]).then(([nextSources, nextStatus]) => {
      if (cancelled) return
      setSources(nextSources)
      setStatus(nextStatus)
      setLoadError('')
      setSourceId(current => nextSources.some(source => source.id === current)
        ? current : (nextSources.find(source => source.id === 'live')?.id || nextSources[0]?.id || ''))
    }).catch(cause => { if (!cancelled) setLoadError(String(cause?.message || cause)) })
    return () => { cancelled = true }
  }, [revision])

  useEffect(() => {
    if (!sourceId || !chatId) { setMessages([]); return }
    let cancelled = false
    void api.messages(sourceId, chatId).then(items => { if (!cancelled) setMessages(items) })
      .catch(cause => { if (!cancelled) setError(String(cause?.message || cause)) })
    return () => { cancelled = true }
  }, [sourceId, chatId, revision])

  useEffect(() => {
    if (!sourceId || view !== 'contacts') return
    let cancelled = false
    void api.contacts(sourceId).then(items => {
      if (!cancelled) setContacts(items)
    }).catch(cause => { if (!cancelled) setError(String(cause?.message || cause)) })
    return () => { cancelled = true }
  }, [sourceId, revision, view])

  useEffect(() => {
    if (!sourceId || view !== 'resources') return
    let cancelled = false
    void api.resources(sourceId).then(items => {
      if (!cancelled) setResources(items)
    }).catch(cause => { if (!cancelled) setError(String(cause?.message || cause)) })
    return () => { cancelled = true }
  }, [sourceId, revision, view])

  useEffect(() => {
    if (sourceId !== 'live' || !chatId || !status.connected) return
    void api.loadMessages(chatId, false).catch(cause => setError(String(cause?.message || cause)))
  }, [sourceId, chatId, status.connected])

  const source = sources.find(item => item.id === sourceId)
  const chat = source?.chats.find(item => item.id === chatId)
  const chats = useMemo(() => [...(source?.chats || [])].sort((a, b) => b.lastMessageAt - a.lastMessageAt), [source])
  const filteredChats = chats.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const filteredContacts = contacts.filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const selectedContact = contacts.find(item => item.id === selectedContactId) || null
  const filteredResources = resources.filter(item => [item.chatTitle, item.kind, item.sender]
    .some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError('')
    setBusy(true)
    try { await action(); setRevision(value => value + 1) }
    catch (cause) { setError(String((cause as Error)?.message || cause)) }
    finally { setBusy(false) }
  }

  const handleImport = () => run(async () => {
    const imported = await api.importJson()
    if (imported) { setSourceId(imported); setChatId(''); setShowConnection(false); setView('chat') }
  })

  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await api.login(Number(apiId), apiHash, phone)
      setApiHash('')
      setAuthStep(null)
      setShowConnection(false)
      setSourceId('live')
      setChatId('')
    })
  }

  const handleAuth = (event: React.FormEvent) => {
    event.preventDefault()
    if (!authStep) return
    void api.submitAuth(authStep, authInput).then(() => { setAuthStep(null); setAuthInput('') })
      .catch(cause => setError(String(cause?.message || cause)))
  }

  const handleSync = () => {
    let range: TelegramSyncRange | undefined
    if (syncPeriod === 'custom') {
      if (!syncStart && !syncEnd) { setError('请选择起始日期或截止日期'); return }
      if (syncStart && syncEnd && syncStart > syncEnd) { setError('起始日期不能晚于截止日期'); return }
      range = { from: syncStart || undefined, to: syncEnd || undefined }
    } else if (syncPeriod !== 'all') {
      const start = new Date()
      start.setDate(start.getDate() - Number(syncPeriod) + 1)
      range = { from: dateInputValue(start) }
    }
    setProgress(null)
    void run(() => api.syncAll(range))
  }

  const handleOlder = async () => {
    if (!chatId) return
    setHistoryBusy(true)
    try { await api.loadMessages(chatId, true) }
    catch (cause) { setError(String((cause as Error)?.message || cause)) }
    finally { setHistoryBusy(false) }
  }

  const handleLogout = () => {
    if (!window.confirm('退出 Telegram 账号？已同步到本机的记录仍会保留。')) return
    void run(() => api.logout())
  }

  const handleRemoveImport = () => {
    if (!source || source.kind !== 'import' || !window.confirm(`移除导入数据“${source.label}”？原始 JSON 文件不会被删除。`)) return
    void run(async () => { await api.removeImport(source.id); setSourceId(''); setChatId('') })
  }

  const handleMedia = (item: TelegramMessage) => {
    void run(async () => {
      const path = item.mediaPath || (sourceId === 'live' ? await api.downloadMedia(chatId, item.id) : '')
      if (!path) return
      const result = await window.electronAPI.shell.openPath(path)
      if (result) throw new Error(result)
    })
  }

  const canOpenResource = (item: TelegramResource): boolean => Boolean(item.mediaPath)
    || (sourceId === 'live' && status.connected && item.kind !== 'text' && item.kind !== 'service')

  const handleResource = (item: TelegramResource) => {
    void run(async () => {
      const path = item.mediaPath || (sourceId === 'live' ? await api.downloadMedia(item.chatId, item.messageId) : '')
      if (!path) return
      const result = await window.electronAPI.shell.openPath(path)
      if (result) throw new Error(result)
    })
  }

  const openContactChat = (chatId: string) => {
    setChatId(chatId)
    setView('chat')
  }

  return (
    <div className="telegram-page">
      <header className="tg-toolbar">
        <div className="tg-title">Telegram</div>
        <select aria-label="数据源" value={sourceId} onChange={event => {
          setSourceId(event.target.value)
          setChatId('')
          setSelectedContactId('')
        }}>
          {!sourceId && <option value="">选择数据源</option>}
          {sources.map(item => <option key={item.id} value={item.id}>{item.kind === 'account' ? '账号 · ' : '导入 · '}{item.label}</option>)}
        </select>
        <div className="tg-view-tabs" role="tablist" aria-label="Telegram 视图">
          {([['chat', '聊天', MessageSquare], ['contacts', '通讯录', Users], ['resources', '资源预览', FolderOpen], ['export', '导出', Download]] as const).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={15} />{label}</button>
          ))}
        </div>
        <div className="tg-toolbar-actions">
          {source?.kind === 'import' && <button className="tg-icon-btn" title="移除导入数据" aria-label="移除导入数据" disabled={busy} onClick={handleRemoveImport}><Trash2 size={18} /></button>}
          <button className="tg-icon-btn" title="导入 Telegram JSON" aria-label="导入 Telegram JSON" disabled={busy} onClick={() => void handleImport()}><Upload size={18} /></button>
          {status.connected && <button className="tg-icon-btn" title="刷新会话" aria-label="刷新会话" disabled={busy} onClick={() => void run(() => api.refresh())}><RefreshCw size={18} /></button>}
          <button className="tg-icon-btn" title="Telegram 账号" aria-label="Telegram 账号" onClick={() => setShowConnection(value => !value)}><Settings2 size={18} /></button>
        </div>
      </header>

      {(error || loadError) && <div className="tg-error" role="alert"><span>{error || loadError}</span><button title="重试" aria-label="重试" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></button><button aria-label="关闭错误" onClick={() => { setError(''); setLoadError('') }}><X size={15} /></button></div>}

      {(showConnection || !sources.length) && (
        <section className="tg-connection">
          <div className="tg-connection-title"><h2>Telegram 账号</h2>{sources.length > 0 && <button className="tg-icon-btn" title="关闭" onClick={() => setShowConnection(false)}><X size={17} /></button>}</div>
          {status.connected ? (
            <>
              <div className="tg-connected"><span>{status.accountName} · 已连接</span><button className="tg-icon-btn" title="退出 Telegram 账号" aria-label="退出 Telegram 账号" onClick={handleLogout}><LogOut size={17} /></button></div>
              <div className="tg-sync-options">
                <label>历史范围<select value={syncPeriod} disabled={busy} onChange={event => setSyncPeriod(event.target.value as typeof syncPeriod)}><option value="all">全部历史</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="custom">自定义日期</option></select></label>
                {syncPeriod === 'custom' && <><label>起始日期<input type="date" value={syncStart} max={syncEnd || undefined} disabled={busy} onChange={event => setSyncStart(event.target.value)} /></label><label>截止日期<input type="date" value={syncEnd} min={syncStart || undefined} disabled={busy} onChange={event => setSyncEnd(event.target.value)} /></label></>}
                <button className="tg-button" onClick={handleSync} disabled={busy || status.syncing}>{status.syncing ? '同步中' : syncPeriod === 'all' ? '同步全部历史' : '同步所选历史'}</button>
                {status.syncing && <button className="tg-button" onClick={() => void api.cancelSync()}>停止</button>}
              </div>
            </>
          ) : (
            <form className="tg-login-form" onSubmit={handleLogin}>
              <label>API ID<input inputMode="numeric" type="number" min="1" required value={apiId} onChange={event => setApiId(event.target.value)} /></label>
              <label>API Hash<input type="password" required value={apiHash} onChange={event => setApiHash(event.target.value)} /></label>
              <label>手机号<input type="tel" required placeholder="+8613800000000" value={phone} onChange={event => setPhone(event.target.value)} /></label>
              <button className="tg-button primary" disabled={busy} type="submit">{busy ? '连接中' : '登录'}</button>
              {status.hasSavedSession && <button className="tg-button" type="button" disabled={busy} onClick={() => void run(() => api.restore())}>恢复会话</button>}
              <small>API ID 和 Hash 可在 my.telegram.org 获取。{!status.secureStorage && '当前系统不支持安全保存会话，退出应用后需重新登录。'}</small>
            </form>
          )}
          {progress && status.syncing && <div className="tg-progress">{progress.completed}/{progress.total} · {progress.chat}</div>}
          <button className="tg-import-link" onClick={() => void handleImport()} disabled={busy}><FileJson size={17} />导入 Desktop JSON</button>
        </section>
      )}

      {authStep && (
        <div className="tg-auth-overlay" role="dialog" aria-modal="true" aria-label={authLabels[authStep]}>
          <form className="tg-auth-dialog" onSubmit={handleAuth}>
            <h2>{authLabels[authStep]}</h2>
            {error && <p className="tg-auth-error" role="alert">{error}</p>}
            <input autoFocus required type={authStep === 'password' ? 'password' : authStep === 'email' ? 'email' : 'text'} value={authInput} onChange={event => setAuthInput(event.target.value)} />
            <div><button type="button" className="tg-button" onClick={() => { void api.cancelAuth(); setAuthStep(null) }}>取消</button><button type="submit" className="tg-button primary">确认</button></div>
          </form>
        </div>
      )}

      {view === 'chat' && source && (
        <div className="tg-chat-layout">
          <aside className="tg-chats">
            <div className="tg-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" /></div>
            <div className="tg-chat-list">{filteredChats.map(item => (
              <button key={item.id} className={`tg-chat-item ${item.id === chatId ? 'active' : ''}`} onClick={() => setChatId(item.id)}>
                <span className="tg-avatar">{item.title.charAt(0).toUpperCase()}</span><span className="tg-chat-meta"><strong>{item.title}</strong><small>{item.kind === 'personal_chat' ? '私聊' : item.kind === 'group' ? '群聊' : '频道'} · {item.messageCount} 条已同步</small></span><span className="tg-chat-time">{item.lastMessageAt ? new Date(item.lastMessageAt * 1000).toLocaleDateString('zh-CN') : ''}</span>
              </button>
            ))}</div>
          </aside>
          <section className="tg-message-area">
            {chat ? <>
              <div className="tg-message-header"><span className="tg-avatar">{chat.title.charAt(0).toUpperCase()}</span><div><strong>{chat.title}</strong><small>{chat.messageCount} 条已同步{!chat.complete && source.kind === 'account' ? ' · 历史未同步完' : ''}</small></div></div>
              <Virtuoso key={`${sourceId}:${chatId}`} className="tg-message-list" data={messages} initialTopMostItemIndex={Math.max(0, messages.length - 1)} followOutput="auto" components={{ Header: () => source.kind === 'account' && status.connected && !chat.complete ? <button className="tg-older" onClick={() => void handleOlder()} disabled={historyBusy}>{historyBusy ? '加载中' : '加载更早消息'}</button> : null }} itemContent={(_, item) => (
                <div className={`tg-message-row ${item.outgoing ? 'sent' : ''}`}><div className="tg-message-bubble"><div className="tg-message-sender">{item.sender || (item.outgoing ? status.accountName : chat.title)}</div>{item.kind !== 'text' && <span className="tg-media-kind">{item.kind}</span>}{item.text && <div className="tg-message-text">{item.text}</div>}{(item.mediaPath || (source.kind === 'account' && status.connected && item.kind !== 'text' && item.kind !== 'service')) && <button className="tg-file-link" onClick={() => handleMedia(item)}>{item.mediaPath ? '打开附件' : '下载附件'}</button>}<time>{dateLabel(item.date)}</time></div></div>
              )} />
            </> : <div className="tg-empty">选择会话</div>}
          </section>
        </div>
      )}

      {view === 'contacts' && source && (
        <div className="tg-contact-layout">
          <aside className="tg-contacts">
            <div className="tg-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索联系人" aria-label="搜索联系人" /></div>
            <div className="tg-contact-list">
              {filteredContacts.map(item => (
                <button key={item.id} className={`tg-contact-item ${item.id === selectedContact?.id ? 'active' : ''}`} onClick={() => setSelectedContactId(item.id)}>
                  <span className="tg-avatar">{item.name.charAt(0).toUpperCase()}</span>
                  <span className="tg-chat-meta">
                    <strong>{item.name}</strong>
                    <small>{item.messageCount} 条消息 · {item.chatCount} 个会话</small>
                  </span>
                  <span className={`tg-contact-badge ${item.outgoing ? 'self' : ''}`}>{item.outgoing ? '本机' : '联系人'}</span>
                </button>
              ))}
            </div>
          </aside>
          <section className="tg-contact-detail">
            {selectedContact ? <>
              <header className="tg-contact-header">
                <span className="tg-avatar">{selectedContact.name.charAt(0).toUpperCase()}</span>
                <div>
                  <strong>{selectedContact.name}</strong>
                  <small>{selectedContact.outgoing ? '本机账号' : '消息联系人'} · {selectedContact.messageCount} 条消息</small>
                </div>
              </header>
              <dl className="tg-contact-stats">
                <div><dt>消息数</dt><dd>{selectedContact.messageCount}</dd></div>
                <div><dt>参与会话</dt><dd>{selectedContact.chatCount}</dd></div>
                <div><dt>最近活动</dt><dd>{selectedContact.lastActiveAt ? dateLabel(selectedContact.lastActiveAt) : '暂无'}</dd></div>
              </dl>
              <div className="tg-contact-chat-list">
                <h3>相关会话</h3>
                {selectedContact.chats.map(chat => (
                  <button key={chat.id} onClick={() => openContactChat(chat.id)}>
                    <MessageCircle size={17} />
                    <span>{chat.title}</span>
                  </button>
                ))}
              </div>
            </> : <div className="tg-empty"><User size={36} /><p>选择联系人查看详情</p></div>}
          </section>
        </div>
      )}

      {view === 'resources' && source && (
        <section className="tg-resources">
          <div className="tg-section-title"><h2>资源预览</h2><span>{source.label} · 共 {resources.length} 条资源</span></div>
          <div className="tg-resource-toolbar">
            <div className="tg-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索会话、类型或发送者" aria-label="搜索资源" /></div>
          </div>
          {filteredResources.length ? <div className="tg-resource-grid">
            {filteredResources.map(item => {
              const openable = canOpenResource(item)
              return (
                <article key={item.id} className="tg-resource-card">
                  <div className="tg-resource-visual"><ResourceKindIcon kind={item.kind} /><span>{resourceKindLabel(item.kind)}</span></div>
                  <div className="tg-resource-meta">
                    <strong title={item.chatTitle}>{item.chatTitle}</strong>
                    <small>{item.sender || '未知'} · {dateLabel(item.date)}</small>
                  </div>
                  <button className="tg-button" disabled={!openable || busy} onClick={() => handleResource(item)}>
                    {item.mediaPath ? '打开' : openable ? '下载并打开' : '不可用'}
                  </button>
                </article>
              )
            })}
          </div> : <div className="tg-empty"><FolderOpen size={36} /><p>暂无资源</p></div>}
        </section>
      )}

      {view === 'export' && source && (
        <div className="tg-export"><div className="tg-section-title"><h2>导出聊天记录</h2><span>{source.label}{source.kind === 'account' && ' · 未同步历史不会包含在导出中'}</span></div>
          <div className="tg-export-controls"><label>格式<select value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="json">JSON</option><option value="csv">CSV</option><option value="md">Markdown</option></select></label><button className="tg-button" disabled={busy || !chats.length} onClick={() => void run(() => api.exportChat(source.id, '*', format))}><Download size={15} />导出全部</button></div>
          <div className="tg-export-list">{chats.map(item => <div key={item.id}><span className="tg-avatar">{item.title.charAt(0).toUpperCase()}</span><div><strong>{item.title}</strong><small>{item.messageCount} 条{!item.complete && source.kind === 'account' ? ' · 部分历史' : ''}</small></div><button className="tg-icon-btn" title={`导出 ${item.title}`} aria-label={`导出 ${item.title}`} disabled={busy} onClick={() => void run(() => api.exportChat(source.id, item.id, format))}><Download size={17} /></button></div>)}</div>
        </div>
      )}

      {!source && !showConnection && <div className="tg-empty-source"><MessageSquare size={36} /><p>暂无 Telegram 数据</p><button className="tg-button primary" onClick={() => setShowConnection(true)}>添加数据源</button></div>}
    </div>
  )
}

export default TelegramPage
