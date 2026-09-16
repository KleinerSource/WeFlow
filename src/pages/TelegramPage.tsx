import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileJson, LogOut, MessageSquare, RefreshCw, Search, Settings2, Trash2, Upload, X } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import type { TelegramAuthStep, TelegramMessage, TelegramProgress, TelegramSource, TelegramStatus } from '../../shared/telegram'
import './TelegramPage.scss'

const api = window.electronAPI.telegram
type View = 'chat' | 'analytics' | 'export'
type Summary = { total: number; media: number; activeDays: number; days: Array<{ label: string; count: number }> }
const authLabels: Record<TelegramAuthStep, string> = { code: 'Telegram 验证码', password: '两步验证密码', email: '验证邮箱', emailCode: '邮箱验证码' }

function dateLabel(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toLocaleString('zh-CN') : ''
}

function TelegramPage() {
  const [sources, setSources] = useState<TelegramSource[]>([])
  const [status, setStatus] = useState<TelegramStatus>({ connected: false, accountName: '', hasSavedSession: false, secureStorage: true, syncing: false })
  const [sourceId, setSourceId] = useState('')
  const [chatId, setChatId] = useState('')
  const [view, setView] = useState<View>('chat')
  const [messages, setMessages] = useState<TelegramMessage[]>([])
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [progress, setProgress] = useState<TelegramProgress | null>(null)
  const [showConnection, setShowConnection] = useState(false)
  const [authStep, setAuthStep] = useState<TelegramAuthStep | null>(null)
  const [authInput, setAuthInput] = useState('')
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [format, setFormat] = useState<'json' | 'csv' | 'md'>('json')
  const [summary, setSummary] = useState<Summary | null>(null)

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
    if (sourceId !== 'live' || !chatId || !status.connected) return
    void api.loadMessages(chatId, false).catch(cause => setError(String(cause?.message || cause)))
  }, [sourceId, chatId, status.connected])

  const source = sources.find(item => item.id === sourceId)
  const chat = source?.chats.find(item => item.id === chatId)
  const chats = useMemo(() => [...(source?.chats || [])].sort((a, b) => b.lastMessageAt - a.lastMessageAt), [source])
  const filteredChats = chats.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  useEffect(() => {
    if (view !== 'analytics' || !source) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let total = 0, media = 0
        const days = new Map<string, number>()
        for (const item of source.chats) {
          const items = await api.messages(source.id, item.id)
          if (cancelled) return
          total += items.length
          for (const message of items) {
            if (message.kind !== 'text' && message.kind !== 'service') media++
            if (message.date) {
              const day = new Date(message.date * 1000).toLocaleDateString('sv-SE')
              days.set(day, (days.get(day) || 0) + 1)
            }
          }
        }
        const recent = Array.from({ length: 7 }, (_, index) => {
          const day = new Date()
          day.setDate(day.getDate() - (6 - index))
          const key = day.toLocaleDateString('sv-SE')
          return { label: `${day.getMonth() + 1}/${day.getDate()}`, count: days.get(key) || 0 }
        })
        if (!cancelled) setSummary({ total, media, activeDays: days.size, days: recent })
      })().catch(cause => { if (!cancelled) setError(String(cause?.message || cause)) })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [source, view])

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
    setProgress(null)
    void run(() => api.syncAll())
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

  return (
    <div className="telegram-page">
      <header className="tg-toolbar">
        <div className="tg-title">Telegram</div>
        <select aria-label="数据源" value={sourceId} onChange={event => { setSourceId(event.target.value); setChatId(''); setSummary(null) }}>
          {!sourceId && <option value="">选择数据源</option>}
          {sources.map(item => <option key={item.id} value={item.id}>{item.kind === 'account' ? '账号 · ' : '导入 · '}{item.label}</option>)}
        </select>
        <div className="tg-view-tabs" role="tablist" aria-label="Telegram 视图">
          {([['chat', '聊天', MessageSquare], ['analytics', '分析', BarChart3], ['export', '导出', Download]] as const).map(([id, label, Icon]) => (
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
            <div className="tg-connected"><span>{status.accountName} · 已连接</span><button className="tg-button" onClick={handleSync} disabled={busy}>{status.syncing ? '同步中' : '同步全部历史'}</button>{status.syncing && <button className="tg-button" onClick={() => void api.cancelSync()}>停止</button>}<button className="tg-icon-btn" title="退出 Telegram 账号" aria-label="退出 Telegram 账号" onClick={handleLogout}><LogOut size={17} /></button></div>
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

      {view === 'analytics' && source && (
        <div className="tg-analysis"><div className="tg-section-title"><h2>聊天分析</h2><span>{source.label}{source.kind === 'account' && ' · 以已同步消息为准'}</span></div>
          <div className="tg-stats"><div><span>会话</span><strong>{source.chats.length}</strong></div><div><span>消息</span><strong>{summary?.total ?? '…'}</strong></div><div><span>媒体</span><strong>{summary?.media ?? '…'}</strong></div><div><span>活跃天数</span><strong>{summary?.activeDays ?? '…'}</strong></div></div>
          <h3>最近 7 天</h3><div className="tg-bars">{summary?.days.map(day => <div key={day.label}><div className="tg-bar-track"><span style={{ height: `${Math.max(day.count ? 6 : 0, day.count / Math.max(1, ...summary.days.map(d => d.count)) * 100)}%` }} /></div><small>{day.label}</small><b>{day.count}</b></div>)}</div>
          <h3>活跃会话</h3><div className="tg-ranked">{[...source.chats].sort((a, b) => b.messageCount - a.messageCount).slice(0, 10).map((item, index) => <div key={item.id}><span>{index + 1}</span><strong>{item.title}</strong><span>{item.messageCount}</span></div>)}</div>
        </div>
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
