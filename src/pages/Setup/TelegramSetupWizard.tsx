import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, FileJson, LogIn, RotateCw } from 'lucide-react'
import type { TelegramAuthStep, TelegramStatus } from '../../../shared/telegram'

const api = window.electronAPI.telegram
const authLabels: Record<TelegramAuthStep, string> = {
  code: 'Telegram 验证码',
  password: '两步验证密码',
  email: '验证邮箱',
  emailCode: '邮箱验证码'
}

interface TelegramSetupWizardProps {
  onComplete: (destination: 'home' | 'telegram') => void
}

function TelegramSetupWizard({ onComplete }: TelegramSetupWizardProps) {
  const [status, setStatus] = useState<TelegramStatus>({ connected: false, accountName: '', hasSavedSession: false, secureStorage: true, syncing: false })
  const [authStep, setAuthStep] = useState<TelegramAuthStep | null>(null)
  const [authInput, setAuthInput] = useState('')
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadStatus = async () => {
    const [nextStatus, sources] = await Promise.all([api.status(), api.sources()])
    setStatus(nextStatus)
    return nextStatus.connected || sources.length > 0
  }

  useEffect(() => {
    const removeAuth = api.onAuthStep(step => { setAuthStep(step); setAuthInput('') })
    const removeAuthError = api.onAuthError(setError)
    void loadStatus().catch(() => undefined)
    return () => { removeAuth(); removeAuthError() }
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    setBusy(true)
    try {
      await action()
      const configured = await loadStatus()
      if (configured) onComplete('telegram')
    } catch (cause) {
      setError(String((cause as Error)?.message || cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="setup-channel-step telegram-setup">
      <div className="setup-channel-header">
        <h2>配置 Telegram</h2>
        <p>可以现在登录或导入数据，也可以进入应用后继续配置。</p>
      </div>

      {status.connected ? (
        <div className="status-message is-success">
          {status.accountName || 'Telegram 账号'}已连接，可以直接进入 Telegram。
        </div>
      ) : (
        <form className="setup-telegram-form" onSubmit={event => {
          event.preventDefault()
          void run(async () => {
            await api.login(Number(apiId), apiHash, phone)
            setApiHash('')
          })
        }}>
          <label>
            API ID
            <input inputMode="numeric" type="number" min="1" required value={apiId} onChange={event => setApiId(event.target.value)} />
          </label>
          <label>
            API Hash
            <input type="password" required value={apiHash} onChange={event => setApiHash(event.target.value)} />
          </label>
          <label>
            手机号
            <input type="tel" required placeholder="+8613800000000" value={phone} onChange={event => setPhone(event.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <LogIn size={16} />{busy ? '连接中...' : '登录'}
          </button>
          {status.hasSavedSession && (
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(() => api.restore())}>
              <RotateCw size={16} />恢复会话
            </button>
          )}
        </form>
      )}

      <div className="setup-secondary-actions">
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(() => api.importJson())}>
          <FileJson size={16} />导入 Desktop JSON
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => onComplete('home')}>
          <ArrowLeft size={16} />稍后再说
        </button>
      </div>

      {error && <div className="error-message"><div className="error-text">{error}</div></div>}
      {status.connected && (
        <button className="btn btn-primary" type="button" onClick={() => onComplete('telegram')}>
          进入 Telegram <ArrowRight size={16} />
        </button>
      )}

      {authStep && (
        <div className="tg-auth-overlay" role="dialog" aria-modal="true" aria-label={authLabels[authStep]}>
          <form className="tg-auth-dialog" onSubmit={event => {
            event.preventDefault()
            void run(() => api.submitAuth(authStep, authInput)).then(() => {
              setAuthStep(null)
              setAuthInput('')
            })
          }}>
            <h2>{authLabels[authStep]}</h2>
            <input autoFocus required type={authStep === 'password' ? 'password' : authStep === 'email' ? 'email' : 'text'} value={authInput} onChange={event => setAuthInput(event.target.value)} />
            <div>
              <button type="button" className="tg-button" onClick={() => { void api.cancelAuth(); setAuthStep(null) }}>取消</button>
              <button type="submit" className="tg-button primary">确认</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

export default TelegramSetupWizard
