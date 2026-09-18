import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, FolderOpen, FolderSearch,
  RotateCcw, ShieldCheck, UserRound
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { dialog } from '../../services/ipc'
import * as configService from '../../services/config'
import ConfirmDialog from '../../components/ConfirmDialog'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const isLinux = navigator.userAgent.toLowerCase().includes('linux')
const isWindows = !isMac && !isLinux
const MAC_KEY_FAQ_URL = 'https://github.com/hicccc77/WeFlow/blob/main/docs/MAC-KEY-FAQ.md'
const DB_PATH_CHINESE_ERROR = '路径包含中文字符，迁移至全英文目录后再试'
const dbPathPlaceholder = isMac
  ? '例如: ~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/2.0b4.0.9'
  : isLinux
    ? '例如: ~/.local/share/WeChat/xwechat_files 或者 ~/Documents/xwechat_files'
    : '例如: C:\\Users\\xxx\\Documents\\xwechat_files'

const steps = [
  { id: 'db', title: '数据库目录', desc: '定位 xwechat_files 目录' },
  { id: 'cache', title: '缓存目录', desc: '设置本地缓存存储位置（可选）' },
  { id: 'key', title: '解密密钥', desc: '获取密钥与自动识别账号' },
  { id: 'image', title: '图片密钥', desc: '获取 XOR 与 AES 密钥' }
] as const
type SetupStepId = typeof steps[number]['id']
type ImageKeyResolveSource = 'manual-cache' | 'prefetch-cache' | 'memory-scan'

interface WeChatSetupWizardProps {
  addAccountMode?: boolean
  onComplete: (destination: 'home' | 'wechat') => void
}

const formatDbKeyFailureMessage = (error?: string, logs?: string[]): string => {
  const base = String(error || '自动获取密钥失败').trim()
  const isInternalLine = (line: string): boolean => {
    const lower = line.toLowerCase()
    return lower.includes('xkey_helper') || lower.includes('[debug]') ||
      lower.includes('breakpoint') || lower.includes('hook installed @') || lower.includes('scanner ')
  }
  const tailLogs = Array.isArray(logs)
    ? logs.map(item => String(item || '').trim())
      .filter(item => Boolean(item) && !isInternalLine(item))
      .map(item => item.length > 80 ? `${item.slice(0, 80)}...` : item)
      .slice(-6)
    : []
  return tailLogs.length === 0 ? base : `${base}；最近状态：${tailLogs.join(' | ')}`
}

const normalizeDbKeyStatusMessage = (message: string): string =>
  isWindows && message.includes('Hook安装成功')
    ? '已准备就绪，现在登录微信或退出登录后重新登录微信'
    : message

const isDbKeyReadyMessage = (message: string): boolean =>
  isWindows
    ? message.includes('现在可以登录') || message.includes('Hook安装成功') ||
      message.includes('已准备就绪，现在登录微信或退出登录后重新登录微信')
    : message.includes('现在可以登录')

const pickLatestWxid = (wxids: Array<{ wxid: string; modifiedTime: number }>): string => {
  if (!Array.isArray(wxids) || wxids.length === 0) return ''
  const fallbackWxid = wxids[0]?.wxid || ''
  const valid = wxids.filter(item => Number.isFinite(item.modifiedTime) && item.modifiedTime > 0)
  if (valid.length === 0) return fallbackWxid
  const latest = [...valid].sort((a, b) => {
    if (b.modifiedTime !== a.modifiedTime) return b.modifiedTime - a.modifiedTime
    return a.wxid.localeCompare(b.wxid)
  })
  return latest[0]?.wxid || fallbackWxid
}

function WeChatSetupWizard({ addAccountMode = false, onComplete }: WeChatSetupWizardProps) {
  const setLoading = useAppStore(state => state.setLoading)
  const setDbConnected = useAppStore(state => state.setDbConnected)
  const [stepIndex, setStepIndex] = useState(addAccountMode ? steps.findIndex(step => step.id === 'key') : 0)
  const [dbPath, setDbPath] = useState('')
  const [decryptKey, setDecryptKey] = useState('')
  const [imageXorKey, setImageXorKey] = useState('')
  const [imageAesKey, setImageAesKey] = useState('')
  const [cachePath, setCachePath] = useState('')
  const [wxid, setWxid] = useState('')
  const [wxidOptions, setWxidOptions] = useState<Array<{ avatarUrl?: string; nickname?: string; wxid: string; modifiedTime: number }>>([])
  const [showWxidSelect, setShowWxidSelect] = useState(false)
  const wxidSelectRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDetectingPath, setIsDetectingPath] = useState(false)
  const [isScanningWxid, setIsScanningWxid] = useState(false)
  const [isFetchingDbKey, setIsFetchingDbKey] = useState(false)
  const [isFetchingImageKey, setIsFetchingImageKey] = useState(false)
  const [showDecryptKey, setShowDecryptKey] = useState(false)
  const [dbKeyStatus, setDbKeyStatus] = useState('')
  const [imageKeyStatus, setImageKeyStatus] = useState('')
  const [isManualStartPrompt, setIsManualStartPrompt] = useState(false)
  const [imageKeyPercent, setImageKeyPercent] = useState<number | null>(null)
  const [isImageKeyVerified, setIsImageKeyVerified] = useState(false)
  const [isImageStepAutoCompleted, setIsImageStepAutoCompleted] = useState(false)
  const [hasReacquiredDbKey, setHasReacquiredDbKey] = useState(!addAccountMode)
  const [showDbKeyConfirm, setShowDbKeyConfirm] = useState(false)
  const [lastDbKeyError, setLastDbKeyError] = useState('')
  const imagePrefetchAttemptRef = useRef('')

  useEffect(() => {
    const removeDb = window.electronAPI.key.onDbKeyStatus((payload: { message: string; level: number }) => {
      const normalizedMessage = normalizeDbKeyStatusMessage(payload.message)
      setDbKeyStatus(normalizedMessage)
      if (isDbKeyReadyMessage(normalizedMessage)) {
        window.electronAPI.notification?.show({
          title: 'WeFlow 准备就绪',
          content: '现在可以登录微信了',
          avatarUrl: './logo.png',
          sessionId: 'weflow-system'
        })
      }
    })
    const removeImage = window.electronAPI.key.onImageKeyStatus((payload: { message: string; percent?: number }) => {
      let msg = payload.message
      let pct = payload.percent
      if (pct === undefined) {
        const match = msg.match(/\(([\d.]+)%\)/)
        if (match) {
          pct = parseFloat(match[1])
          msg = msg.replace(/\s*\([\d.]+%\)/, '')
        }
      }
      setImageKeyStatus(msg)
      if (pct !== undefined) setImageKeyPercent(pct)
      else if (msg.includes('启动多核') || msg.includes('定位') || msg.includes('准备')) setImageKeyPercent(0)
    })
    return () => { removeDb?.(); removeImage?.() }
  }, [])

  useEffect(() => {
    setWxidOptions([])
    setWxid('')
    setShowWxidSelect(false)
    setIsImageKeyVerified(false)
    setIsImageStepAutoCompleted(false)
    if (addAccountMode) {
      setHasReacquiredDbKey(false)
      setDecryptKey('')
    }
    imagePrefetchAttemptRef.current = ''
  }, [dbPath, addAccountMode])

  useEffect(() => {
    if (!addAccountMode) return
    let cancelled = false
    const hydrate = async () => {
      try {
        const [savedDbPath, savedCachePath, savedWxid, savedImageXorKey, savedImageAesKey] = await Promise.all([
          configService.getDbPath(),
          configService.getCachePath(),
          configService.getMyWxid(),
          configService.getImageXorKey(),
          configService.getImageAesKey()
        ])
        if (cancelled) return
        setDbPath(savedDbPath || '')
        setCachePath(savedCachePath || '')
        setDecryptKey('')
        setHasReacquiredDbKey(false)
        if (typeof savedImageXorKey === 'number' && Number.isFinite(savedImageXorKey)) {
          setImageXorKey(`0x${savedImageXorKey.toString(16).toUpperCase().padStart(2, '0')}`)
        }
        setImageAesKey(savedImageAesKey || '')
        if (savedDbPath) {
          const scannedWxids = await window.electronAPI.dbPath.scanWxids(savedDbPath)
          if (cancelled) return
          setWxidOptions(scannedWxids)
          const matched = scannedWxids.find(item => item.wxid === savedWxid)
          setWxid(matched?.wxid || savedWxid || scannedWxids[0]?.wxid || '')
        } else if (savedWxid) {
          setWxid(savedWxid)
        }
      } catch (cause) {
        if (!cancelled) setError(`加载当前账号配置失败: ${cause}`)
      }
    }
    void hydrate()
    return () => { cancelled = true }
  }, [addAccountMode])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showWxidSelect) return
      if (wxidSelectRef.current && !wxidSelectRef.current.contains(event.target as Node)) setShowWxidSelect(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showWxidSelect])

  const currentStep = steps[stepIndex] ?? steps[0]
  const validatePath = (path: string): string | null =>
    path && /[\u4e00-\u9fa5]/.test(path) ? DB_PATH_CHINESE_ERROR : null
  const dbPathValidationError = validatePath(dbPath)

  const handleDbPathChange = (value: string) => {
    setDbPath(value)
    const validationError = validatePath(value)
    if (validationError) setError(validationError)
    else if (error === DB_PATH_CHINESE_ERROR) setError('')
  }

  const handleSelectPath = async () => {
    try {
      const result = await dialog.openFile({ title: '选择微信数据库目录', properties: ['openDirectory'] })
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        setDbPath(selectedPath)
        const validationError = validatePath(selectedPath)
        setError(validationError || '')
      }
    } catch {
      setError('选择目录失败')
    }
  }

  const handleAutoDetectPath = async () => {
    if (isDetectingPath) return
    setIsDetectingPath(true)
    setError('')
    try {
      const result = await window.electronAPI.dbPath.autoDetect()
      if (result.success && result.path) {
        setDbPath(result.path)
        setError(validatePath(result.path) || '')
      } else {
        setError(result.error || '未能检测到数据库目录')
      }
    } catch (cause) {
      setError(`自动检测失败: ${cause}`)
    } finally {
      setIsDetectingPath(false)
    }
  }

  const handleSelectCachePath = async () => {
    try {
      const result = await dialog.openFile({ title: '选择缓存目录', properties: ['openDirectory'] })
      if (!result.canceled && result.filePaths.length > 0) {
        setCachePath(result.filePaths[0])
        setError('')
      }
    } catch {
      setError('选择缓存目录失败')
    }
  }

  const handleScanWxid = async (silent = false) => {
    if (!dbPath) {
      if (!silent) setError('请先选择数据库目录')
      return
    }
    if (isScanningWxid) return
    setIsScanningWxid(true)
    if (!silent) setError('')
    try {
      const scanned = await window.electronAPI.dbPath.scanWxids(dbPath)
      setWxidOptions(scanned)
      if (scanned.length > 0) {
        setWxid(pickLatestWxid(scanned) || scanned[0].wxid)
        if (!silent) setError('')
      } else if (!silent) setError('未检测到账号目录，请检查路径')
    } catch (cause) {
      if (!silent) setError(`扫描失败: ${cause}`)
    } finally {
      setIsScanningWxid(false)
    }
  }

  const handleScanWxidCandidates = async () => {
    if (!dbPath) {
      setError('请先选择数据库目录')
      return
    }
    if (isScanningWxid) return
    setIsScanningWxid(true)
    setError('')
    try {
      const scanned = await window.electronAPI.dbPath.scanWxidCandidates(dbPath)
      setWxidOptions(scanned)
      setShowWxidSelect(true)
      if (!scanned.length) setError('未检测到可用的账号目录，请检查路径')
    } catch (cause) {
      setError(`扫描失败: ${cause}`)
    } finally {
      setIsScanningWxid(false)
    }
  }

  const handleDbKeyConfirm = async () => {
    setShowDbKeyConfirm(false)
    setIsFetchingDbKey(true)
    setError('')
    setLastDbKeyError('')
    setIsManualStartPrompt(false)
    setDbKeyStatus('正在连接微信进程...')
    try {
      const result = await window.electronAPI.key.autoGetDbKey()
      if (result.success && result.key) {
        setDecryptKey(result.key)
        setHasReacquiredDbKey(true)
        setDbKeyStatus('密钥获取成功')
        setError('')
        await handleScanWxid(true)
      } else {
        if (addAccountMode) setHasReacquiredDbKey(false)
        if (
          result.error?.includes('未找到微信安装路径') ||
          result.error?.includes('启动微信失败') ||
          result.error?.includes('未能自动启动微信') ||
          result.error?.includes('未找到微信进程') ||
          result.error?.includes('微信进程未运行')
        ) {
          setIsManualStartPrompt(true)
          setDbKeyStatus('需要手动启动微信')
        } else {
          if (result.error?.includes('尚未完成登录')) setDbKeyStatus('请先在微信完成登录后重试')
          const failureMessage = formatDbKeyFailureMessage(result.error, result.logs)
          setError(failureMessage)
          setLastDbKeyError(failureMessage)
        }
      }
    } catch (cause) {
      const failureMessage = `自动获取密钥失败: ${cause}`
      setError(failureMessage)
      setLastDbKeyError(failureMessage)
    } finally {
      setIsFetchingDbKey(false)
    }
  }

  const handleAutoGetImageKey = async (source: ImageKeyResolveSource = 'manual-cache', options?: { silentError?: boolean }) => {
    if (isFetchingImageKey) return
    if (!dbPath) {
      setError('请先选择数据库目录')
      return
    }
    setIsFetchingImageKey(true)
    if (!options?.silentError) setError('')
    setImageKeyPercent(0)
    setImageKeyStatus(source === 'prefetch-cache' ? '正在预计算图片密钥...' : '正在准备获取图片密钥...')
    try {
      const accountPath = wxid ? `${dbPath}/${wxid}` : dbPath
      const result = await window.electronAPI.key.autoGetImageKey(accountPath, wxid)
      if (result.success && result.aesKey) {
        if (typeof result.xorKey === 'number') setImageXorKey(`0x${result.xorKey.toString(16).toUpperCase().padStart(2, '0')}`)
        setImageAesKey(result.aesKey)
        const verified = result.verified === true
        setIsImageKeyVerified(verified)
        setIsImageStepAutoCompleted(verified)
        setImageKeyStatus(verified
          ? (source === 'prefetch-cache' ? '图片密钥已预先自动完成（缓存校验通过）' : '图片密钥获取成功（缓存校验通过）')
          : '已自动计算图片密钥（未完成校验）')
      } else {
        setIsImageKeyVerified(false)
        setIsImageStepAutoCompleted(false)
        if (!options?.silentError) setError(result.error || '自动获取图片密钥失败')
      }
    } catch (cause) {
      setIsImageKeyVerified(false)
      setIsImageStepAutoCompleted(false)
      if (!options?.silentError) setError(`自动获取图片密钥失败: ${cause}`)
    } finally {
      setIsFetchingImageKey(false)
    }
  }

  const handleScanImageKeyFromMemory = async () => {
    if (isFetchingImageKey) return
    if (!dbPath) {
      setError('请先选择数据库目录')
      return
    }
    setIsFetchingImageKey(true)
    setError('')
    setImageKeyPercent(0)
    setImageKeyStatus('正在扫描内存...')
    try {
      const accountPath = wxid ? `${dbPath}/${wxid}` : dbPath
      const result = await window.electronAPI.key.scanImageKeyFromMemory(accountPath)
      if (result.success && result.aesKey) {
        if (typeof result.xorKey === 'number') setImageXorKey(`0x${result.xorKey.toString(16).toUpperCase().padStart(2, '0')}`)
        setImageAesKey(result.aesKey)
        setIsImageKeyVerified(false)
        setIsImageStepAutoCompleted(false)
        setImageKeyStatus('内存扫描成功，已获取图片密钥')
      } else {
        setError(result.error || '内存扫描获取图片密钥失败')
      }
    } catch (cause) {
      setError(`内存扫描失败: ${cause}`)
    } finally {
      setIsFetchingImageKey(false)
    }
  }

  useEffect(() => {
    if (!dbPath || !wxid || decryptKey.length !== 64) return
    const attemptKey = `${dbPath}::${wxid}::${decryptKey}`
    if (imagePrefetchAttemptRef.current === attemptKey) return
    imagePrefetchAttemptRef.current = attemptKey
    void handleAutoGetImageKey('prefetch-cache', { silentError: true })
  }, [dbPath, wxid, decryptKey])

  const jumpToStep = (stepId: SetupStepId) => {
    const targetIndex = steps.findIndex(step => step.id === stepId)
    if (targetIndex >= 0) setStepIndex(targetIndex)
  }

  const validateDbStepBeforeNext = async (): Promise<string | null> => {
    if (!dbPath) return '数据库目录步骤未完成：请先选择数据库目录'
    if (dbPathValidationError) return `数据库目录步骤配置有误：${dbPathValidationError}`
    try {
      const scanned = await window.electronAPI.dbPath.scanWxids(dbPath)
      if (!Array.isArray(scanned) || scanned.length === 0) {
        return '数据库目录步骤配置有误：当前目录下未找到可用账号数据（缺少 db_storage），请重新选择微信数据目录'
      }
    } catch (cause) {
      return `数据库目录步骤配置有误：目录读取失败，请确认此路径可访问（${String(cause)}）`
    }
    return null
  }

  const findConfigIssueBeforeConnect = async (): Promise<{ stepId: SetupStepId; message: string } | null> => {
    const dbIssue = await validateDbStepBeforeNext()
    if (dbIssue) return { stepId: 'db', message: dbIssue }
    let scanned: Array<{ wxid: string }> = []
    try {
      scanned = await window.electronAPI.dbPath.scanWxids(dbPath)
    } catch {
      scanned = []
    }
    if (!wxid) return { stepId: 'key', message: '解密密钥步骤未完成：请先选择微信账号 (wxid)' }
    if (!scanned.some(item => item.wxid === wxid)) {
      return { stepId: 'key', message: `微信账号「${wxid}」不在当前数据库目录中，请重新选择账号` }
    }
    if (!decryptKey || decryptKey.length !== 64) return { stepId: 'key', message: '解密密钥步骤未完成：请填写 64 位解密密钥' }
    return null
  }

  const canGoNext = () => {
    if (addAccountMode) {
      if (currentStep.id === 'key') return hasReacquiredDbKey && decryptKey.length === 64 && Boolean(wxid)
      return true
    }
    if (currentStep.id === 'db') return Boolean(dbPath) && !dbPathValidationError
    if (currentStep.id === 'cache') return true
    if (currentStep.id === 'key') return decryptKey.length === 64 && Boolean(wxid)
    if (currentStep.id === 'image') return true
    return false
  }

  const handleNext = async () => {
    if (addAccountMode) {
      await handleConnect()
      return
    }
    if (currentStep.id === 'db') {
      const issue = await validateDbStepBeforeNext()
      if (issue) {
        setError(issue)
        return
      }
    }
    if (!canGoNext()) {
      if (currentStep.id === 'db' && !dbPath) setError('请先选择数据库目录')
      if (currentStep.id === 'db' && dbPathValidationError) setError(dbPathValidationError)
      if (currentStep.id === 'key') {
        if (decryptKey.length !== 64) setError('密钥长度必须为 64 个字符')
        else if (!wxid) setError('未能自动识别 wxid，请尝试重新获取或检查目录')
      }
      return
    }
    setError('')
    setStepIndex(prev => Math.min(prev + 1, steps.length - 1))
  }

  const handleConnect = async () => {
    if (addAccountMode && !hasReacquiredDbKey) {
      setError('请先在当前流程中自动获取一次数据库密钥')
      return
    }
    const issue = await findConfigIssueBeforeConnect()
    if (issue) {
      setError(issue.message)
      jumpToStep(issue.stepId)
      return
    }
    setIsConnecting(true)
    setError('')
    setLoading(true, '正在连接数据库...')
    try {
      const result = await window.electronAPI.wcdb.testConnection(dbPath, decryptKey, wxid)
      if (!result.success) {
        const errorMessage = result.error || 'WCDB 连接失败'
        if (errorMessage.includes('-3001')) {
          const fallbackIssue = await findConfigIssueBeforeConnect()
          setError(fallbackIssue?.message || `数据库目录步骤配置有误：${errorMessage}`)
          jumpToStep(fallbackIssue?.stepId || 'db')
        } else {
          setError(errorMessage)
        }
        return
      }

      await configService.setDbPath(dbPath)
      await configService.setDecryptKey(decryptKey)
      await configService.setMyWxid(wxid)
      await configService.setCachePath(cachePath)
      const parsedXorKey = imageXorKey ? parseInt(imageXorKey.replace(/^0x/i, ''), 16) : null
      const normalizedXorKey = typeof parsedXorKey === 'number' && !Number.isNaN(parsedXorKey) ? parsedXorKey : 0
      await configService.setImageXorKey(normalizedXorKey)
      await configService.setImageAesKey(imageAesKey || '')
      await configService.setWxidConfig(wxid, {
        decryptKey,
        imageXorKey: normalizedXorKey,
        imageAesKey
      })
      await configService.setOnboardingDone(true)
      setDbConnected(true, dbPath)
      onComplete('wechat')
    } catch (cause) {
      setError(`连接失败: ${cause}`)
    } finally {
      setLoading(false)
      setIsConnecting(false)
    }
  }

  const formatModifiedTime = (time: number) => {
    if (!time) return '未知时间'
    const date = new Date(time)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`
  }

  const isStepCompleted = (index: number, stepId: SetupStepId): boolean => {
    if (index < stepIndex) return true
    if (stepId === 'image' && isImageStepAutoCompleted) return true
    if (addAccountMode && stepId !== 'key') return true
    return false
  }

  const resolveStepDesc = (step: { desc: string; id: SetupStepId }): string => {
    if (step.id === 'image' && isImageStepAutoCompleted) return '缓存校验成功，已自动完成'
    if (addAccountMode && step.id !== 'key') return '已沿用当前配置'
    return step.desc
  }

  return (
    <div className="setup-wizard">
      <aside className="welcome-sidebar">
        <div className="sidebar-header">
          <img src="./logo.png" alt="WeFlow" className="sidebar-logo" />
          <div className="sidebar-brand">
            <span className="brand-name">WeFlow</span>
            <span className="brand-tag">WeChat Setup</span>
          </div>
        </div>
        <div className="sidebar-nav">
          {steps.map((step, index) => (
            <div key={step.id} className={`nav-item ${index === stepIndex ? 'active' : ''} ${isStepCompleted(index, step.id) ? 'completed' : ''}`}>
              <div className="nav-indicator">
                {isStepCompleted(index, step.id) ? <CheckCircle2 size={14} /> : <div className="dot" />}
              </div>
              <div className="nav-info">
                <div className="nav-title">{step.title}</div>
                <div className="nav-desc">{resolveStepDesc(step)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="sidebar-footer"><ShieldCheck size={14} /><span>微信数据仅在本地处理</span></div>
      </aside>

      <section className="welcome-content">
        <div className="content-header">
          <div>
            <h2>{currentStep.title}</h2>
            <p className="header-desc">{currentStep.desc}</p>
            {addAccountMode && <p className="header-mode-tip">添加账号模式：其他步骤沿用当前配置，只需重新获取数据库密钥。</p>}
          </div>
        </div>

        <div className="content-body">
          {currentStep.id === 'db' && (
            <div className="form-group">
              <label className="field-label">数据库根目录</label>
              <input className="field-input" placeholder={dbPathPlaceholder} value={dbPath} onChange={event => handleDbPathChange(event.target.value)} />
              <div className="action-row">
                <button className="btn btn-secondary" onClick={handleAutoDetectPath} disabled={isDetectingPath}>
                  <FolderSearch size={16} />{isDetectingPath ? '检测中...' : '自动检测'}
                </button>
                <button className="btn btn-secondary" onClick={handleSelectPath}><FolderOpen size={16} />浏览...</button>
              </div>
              <div className="field-hint">请选择微信-设置-存储位置对应的目录</div>
            </div>
          )}

          {currentStep.id === 'cache' && (
            <div className="form-group">
              <label className="field-label">缓存目录</label>
              <input className="field-input" placeholder="留空即使用默认目录" value={cachePath} onChange={event => setCachePath(event.target.value)} />
              <div className="action-row">
                <button className="btn btn-secondary" onClick={handleSelectCachePath}><FolderOpen size={16} />浏览</button>
                <button className="btn btn-secondary" onClick={() => setCachePath('')}><RotateCcw size={16} />重置默认</button>
              </div>
              <div className="field-hint">用于头像、表情与图片缓存</div>
            </div>
          )}

          {currentStep.id === 'key' && (
            <div className="form-group">
              <label className="field-label">微信账号 (Wxid)</label>
              <div className="wxid-select" ref={wxidSelectRef}>
                <input className="field-input" placeholder="点击选择..." value={wxid} readOnly onClick={handleScanWxidCandidates} onChange={() => undefined} />
                {showWxidSelect && wxidOptions.length > 0 && (
                  <div className="wxid-dropdown">
                    {wxidOptions.map(option => (
                      <button key={option.wxid} type="button" className={`wxid-option ${option.wxid === wxid ? 'active' : ''}`} onClick={() => {
                        setWxid(option.wxid)
                        setShowWxidSelect(false)
                      }}>
                        <div className="wxid-profile">
                          {option.avatarUrl ? <img src={option.avatarUrl} alt="" className="wxid-avatar" /> : <div className="wxid-avatar-fallback"><UserRound size={14} /></div>}
                          <div className="wxid-info">
                            <span className="wxid-nickname">{option.nickname || option.wxid}</span>
                            {option.nickname && <span className="wxid-sub">{option.wxid}</span>}
                          </div>
                        </div>
                        <span className="wxid-time">{formatModifiedTime(option.modifiedTime)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="field-label mt-4">解密密钥</label>
              <div className="field-with-toggle">
                <input type={showDecryptKey ? 'text' : 'password'} className="field-input" placeholder="64 位十六进制密钥" value={decryptKey} onChange={event => {
                  const value = event.target.value.trim()
                  setDecryptKey(value)
                  if (value.length === 64) setHasReacquiredDbKey(true)
                }} />
                <button type="button" className="toggle-btn" onClick={() => setShowDecryptKey(!showDecryptKey)}>
                  {showDecryptKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div className="key-actions">
                {isManualStartPrompt ? (
                  <div className="manual-prompt">
                    <p>未能自动启动微信，请手动启动微信，看到登录窗口后点击下方确认</p>
                    <button className="btn btn-primary" onClick={() => { setIsManualStartPrompt(false); setShowDbKeyConfirm(true) }}>我已看到登录窗口，继续</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-block" onClick={() => setShowDbKeyConfirm(true)} disabled={isFetchingDbKey}>
                    {isFetchingDbKey ? '正在获取...' : '自动获取密钥'}
                  </button>
                )}
              </div>

              {dbKeyStatus && <div className={`status-message ${isDbKeyReadyMessage(dbKeyStatus) ? 'is-success' : ''}`}>{dbKeyStatus}</div>}
              {addAccountMode && !hasReacquiredDbKey && <div className="field-hint">添加账号模式下需先自动获取一次数据库密钥，才能完成并返回主窗口。</div>}
            </div>
          )}

          {currentStep.id === 'image' && (
            <div className="form-group">
              <div className="auto-image-key-preview">
                <div className="auto-image-key-row"><span className="auto-image-key-label">图片 XOR 密钥</span><code>{imageXorKey || '等待自动计算'}</code></div>
                <div className="auto-image-key-row"><span className="auto-image-key-label">图片 AES 密钥</span><code>{imageAesKey || '等待自动计算'}</code></div>
              </div>
              <div className="action-row">
                <button className="btn btn-primary" onClick={() => void handleAutoGetImageKey('manual-cache')} disabled={isFetchingImageKey}>
                  {isFetchingImageKey ? '获取中...' : '缓存计算（推荐）'}
                </button>
                <button className="btn btn-secondary" onClick={() => void handleScanImageKeyFromMemory()} disabled={isFetchingImageKey}>
                  {isFetchingImageKey ? '扫描中...' : '内存扫描'}
                </button>
              </div>
              {isFetchingImageKey ? (
                <div className="brute-force-progress">
                  <div className="status-header">
                    <span className="status-text">{imageKeyStatus || '正在启动...'}</span>
                    {typeof imageKeyPercent === 'number' && Number.isFinite(imageKeyPercent) && (
                      <span className="status-text">{Math.max(0, Math.min(100, imageKeyPercent)).toFixed(1)}%</span>
                    )}
                  </div>
                </div>
              ) : imageKeyStatus && <div className="status-message">{imageKeyStatus}</div>}
              {isImageKeyVerified && <div className="status-message is-success">当前密钥已通过缓存校验，可继续完成配置。</div>}
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <div className="error-text">{error}</div>
            {isMac && error === lastDbKeyError && (
              <button type="button" className="error-link-btn" onClick={() => void window.electronAPI.shell.openExternal(MAC_KEY_FAQ_URL)}>
                查看 macOS 获取密钥排障指引
              </button>
            )}
          </div>
        )}

        <div className="content-actions">
          <button className="btn btn-ghost" onClick={() => { setError(''); setStepIndex(prev => Math.max(prev - 1, 0)) }} disabled={stepIndex === 0 || addAccountMode || isConnecting}>
            <ArrowLeft size={16} />上一步
          </button>
          <div className="setup-action-group">
            {!addAccountMode && (
              <button className="btn btn-ghost" onClick={() => onComplete('home')} disabled={isConnecting}>稍后再说</button>
            )}
            {stepIndex < steps.length - 1 ? (
              <button className="btn btn-primary" onClick={() => void handleNext()} disabled={isConnecting || !canGoNext()}>
                下一步 <ArrowRight size={16} />
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void handleConnect()} disabled={isConnecting || !canGoNext()}>
                {isConnecting ? '连接中...' : '完成配置'} <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={showDbKeyConfirm}
        title="开始获取数据库密钥"
        message={`当开始获取后 WeFlow 将会执行准备操作。
${isLinux ? `
【Linux 用户特别注意】如果微信里勾选了自动登录，请先关闭自动登录后再继续。
` : ''}
当 WeFlow 内的提示条显示允许登录或收到登录通知时，请在手机上确认登录微信。`}
        onConfirm={() => void handleDbKeyConfirm()}
        onCancel={() => setShowDbKeyConfirm(false)}
      />
    </div>
  )
}

export default WeChatSetupWizard
