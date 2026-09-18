import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Home, MessageCircle, Settings, Download, Aperture, UserCircle, Lock, LockOpen,
  ChevronUp, FolderClosed, Footprints, ArchiveRestore
} from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useChannelStore } from '../stores/channelStore'
import * as configService from '../services/config'
import { onExportSessionStatus, requestExportSessionStatus } from '../services/exportBridge'
import type { ChannelId } from '../../shared/channel'
import './Sidebar.scss'

interface SidebarUserProfile {
  wxid: string
  displayName: string
  alias?: string
  avatarUrl?: string
}

const PROFILE_CACHE_KEY = 'sidebar_user_profile_cache_v1'
const DEFAULT_DISPLAY_NAME = '微信用户'

const readProfileCache = (): SidebarUserProfile | null => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_CACHE_KEY) || 'null')
    return parsed?.wxid ? parsed as SidebarUserProfile : null
  } catch {
    return null
  }
}

const writeProfileCache = (profile: SidebarUserProfile) => {
  try {
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ ...profile, updatedAt: Date.now() }))
  } catch {
    // Cache failures must not affect navigation.
  }
}

interface SidebarProps {
  collapsed: boolean
}

function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const setLocked = useAppStore(state => state.setLocked)
  const enabledChannels = useChannelStore(state => state.enabledChannels)
  const availability = useChannelStore(state => state.availability)
  const wechatEnabled = enabledChannels.includes('wechat')
  const wechatConfigured = wechatEnabled && availability.wechat.configured
  const telegramEnabled = enabledChannels.includes('telegram')
  const telegramConfigured = telegramEnabled && availability.telegram.configured

  const [authEnabled, setAuthEnabled] = useState(false)
  const [activeExportTaskCount, setActiveExportTaskCount] = useState(0)
  const [userProfile, setUserProfile] = useState<SidebarUserProfile>(() =>
    readProfileCache() || { wxid: '', displayName: DEFAULT_DISPLAY_NAME }
  )
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountCardWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.electronAPI.auth.verifyEnabled().then(setAuthEnabled)
  }, [])

  useEffect(() => {
    const unsubscribe = onExportSessionStatus(payload => {
      const count = typeof payload?.activeTaskCount === 'number'
        ? payload.activeTaskCount
        : Array.isArray(payload?.inProgressSessionIds) ? payload.inProgressSessionIds.length : 0
      setActiveExportTaskCount(Math.max(0, Math.floor(count)))
    })
    requestExportSessionStatus()
    const timer = window.setTimeout(requestExportSessionStatus, 120)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!wechatConfigured) return
    let disposed = false
    const load = async () => {
      try {
        const wxid = await configService.getMyWxid()
        if (!wxid || disposed) return
        setUserProfile(prev => {
          const next = { ...prev, wxid, displayName: prev.displayName || DEFAULT_DISPLAY_NAME }
          writeProfileCache(next)
          return next
        })
        const [contact, avatar] = await Promise.allSettled([
          window.electronAPI.chat.getContact(wxid),
          window.electronAPI.chat.getMyAvatarUrl()
        ])
        if (disposed) return
        const contactInfo = contact.status === 'fulfilled' ? contact.value : null
        const avatarInfo = avatar.status === 'fulfilled' ? avatar.value : null
        setUserProfile({
          wxid,
          displayName: contactInfo?.remark || contactInfo?.nickName || contactInfo?.alias || DEFAULT_DISPLAY_NAME,
          alias: contactInfo?.alias,
          avatarUrl: avatarInfo?.success ? avatarInfo.avatarUrl : undefined
        })
      } catch {
        // Keep the cached profile when IPC temporarily fails.
      }
    }
    void load()
    const onWxidChanged = () => { void load() }
    window.addEventListener('wxid-changed', onWxidChanged as EventListener)
    return () => {
      disposed = true
      window.removeEventListener('wxid-changed', onWxidChanged as EventListener)
    }
  }, [wechatConfigured])

  useEffect(() => {
    if (!isAccountMenuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (accountCardWrapRef.current && !accountCardWrapRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAccountMenuOpen])

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  const exportTaskBadge = activeExportTaskCount > 99 ? '99+' : `${activeExportTaskCount}`
  const lockActionLabel = authEnabled ? '锁定应用' : '开启应用锁'
  const primaryChannelName = wechatConfigured ? '微信' : telegramConfigured ? 'Telegram' : '未配置渠道'
  const channelUserSubtitle = enabledChannels.length > 0 ? `已启用 ${enabledChannels.length} 个渠道` : '请先选择渠道'

  const openChannelSetup = (channel: ChannelId) => {
    void window.electronAPI.window.openOnboardingWindow({ mode: 'add-channel', channel })
  }

  const openSettings = () => {
    setIsAccountMenuOpen(false)
    navigate('/settings', { state: { backgroundLocation: location } })
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="nav-menu">
        <div className="nav-section">
          <div className="nav-section-label">全局</div>
          <NavLink to="/home" className={`nav-item ${isActive('/home') ? 'active' : ''}`} title={collapsed ? '首页' : undefined}>
            <span className="nav-icon"><Home size={20} /></span>
            <span className="nav-label">首页</span>
          </NavLink>
        </div>

        {wechatEnabled && (
          <div className="nav-section">
            <div className="nav-section-label">微信</div>
            {wechatConfigured ? (
              <>
                <NavLink to="/chat" className={`nav-item ${isActive('/chat') ? 'active' : ''}`} title={collapsed ? '聊天' : undefined}>
                  <span className="nav-icon"><MessageCircle size={20} /></span>
                  <span className="nav-label">聊天</span>
                </NavLink>
                <NavLink to="/sns" className={`nav-item ${isActive('/sns') ? 'active' : ''}`} title={collapsed ? '朋友圈' : undefined}>
                  <span className="nav-icon"><Aperture size={20} /></span>
                  <span className="nav-label">朋友圈</span>
                </NavLink>
                <NavLink to="/contacts" className={`nav-item ${isActive('/contacts') ? 'active' : ''}`} title={collapsed ? '通讯录' : undefined}>
                  <span className="nav-icon"><UserCircle size={20} /></span>
                  <span className="nav-label">通讯录</span>
                </NavLink>
                <NavLink to="/resources" className={`nav-item ${isActive('/resources') ? 'active' : ''}`} title={collapsed ? '资源浏览' : undefined}>
                  <span className="nav-icon"><FolderClosed size={20} /></span>
                  <span className="nav-label">资源浏览</span>
                </NavLink>
                <NavLink to="/footprint" className={`nav-item ${isActive('/footprint') ? 'active' : ''}`} title={collapsed ? '我的足迹' : undefined}>
                  <span className="nav-icon"><Footprints size={20} /></span>
                  <span className="nav-label">我的足迹</span>
                </NavLink>
                <NavLink to="/export" className={`nav-item ${isActive('/export') ? 'active' : ''}`} title={collapsed ? '导出' : undefined}>
                  <span className="nav-icon nav-icon-with-badge">
                    <Download size={20} />
                    {collapsed && activeExportTaskCount > 0 && <span className="nav-badge icon-badge">{exportTaskBadge}</span>}
                  </span>
                  <span className="nav-label">导出</span>
                  {!collapsed && activeExportTaskCount > 0 && <span className="nav-badge">{exportTaskBadge}</span>}
                </NavLink>
                <NavLink to="/backup" className={`nav-item ${isActive('/backup') ? 'active' : ''}`} title={collapsed ? '数据库备份' : undefined}>
                  <span className="nav-icon"><ArchiveRestore size={20} /></span>
                  <span className="nav-label">数据库备份</span>
                </NavLink>
              </>
            ) : (
              <button type="button" className="nav-item" onClick={() => openChannelSetup('wechat')} title={collapsed ? '配置微信' : undefined}>
                <span className="nav-icon"><MessageCircle size={20} /></span>
                <span className="nav-label">配置微信</span>
              </button>
            )}
          </div>
        )}

        {telegramEnabled && (
          <div className="nav-section">
            <div className="nav-section-label">Telegram</div>
            {telegramConfigured ? (
              <>
                <NavLink to="/telegram/chat" className={`nav-item ${isActive('/telegram/chat') ? 'active' : ''}`} title={collapsed ? '聊天' : undefined}>
                  <span className="nav-icon"><MessageCircle size={20} /></span>
                  <span className="nav-label">聊天</span>
                </NavLink>
                <NavLink to="/telegram/contacts" className={`nav-item ${isActive('/telegram/contacts') ? 'active' : ''}`} title={collapsed ? '通讯录' : undefined}>
                  <span className="nav-icon"><UserCircle size={20} /></span>
                  <span className="nav-label">通讯录</span>
                </NavLink>
                <NavLink to="/telegram/resources" className={`nav-item ${isActive('/telegram/resources') ? 'active' : ''}`} title={collapsed ? '资源浏览' : undefined}>
                  <span className="nav-icon"><FolderClosed size={20} /></span>
                  <span className="nav-label">资源浏览</span>
                </NavLink>
                <NavLink to="/telegram/export" className={`nav-item ${isActive('/telegram/export') ? 'active' : ''}`} title={collapsed ? '导出' : undefined}>
                  <span className="nav-icon"><Download size={20} /></span>
                  <span className="nav-label">导出</span>
                </NavLink>
              </>
            ) : (
              <button type="button" className="nav-item" onClick={() => openChannelSetup('telegram')} title={collapsed ? '配置 Telegram' : undefined}>
                <span className="nav-icon"><MessageCircle size={20} /></span>
                <span className="nav-label">配置 Telegram</span>
              </button>
            )}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          className="nav-item sidebar-lock-action"
          onClick={() => {
            if (authEnabled) {
              setLocked(true)
              return
            }
            navigate('/settings', { state: { initialTab: 'security', backgroundLocation: location } })
          }}
          title={collapsed ? lockActionLabel : undefined}
          aria-label={lockActionLabel}
        >
          <span className="nav-icon">{authEnabled ? <Lock size={20} /> : <LockOpen size={20} />}</span>
          <span className="nav-label">{lockActionLabel}</span>
        </button>

        <div className="sidebar-user-card-wrap" ref={accountCardWrapRef}>
          <div className={`sidebar-user-menu ${isAccountMenuOpen ? 'open' : ''}`} role="menu" aria-label="渠道菜单">
            {wechatConfigured && (
              <button
                type="button"
                role="menuitem"
                className="sidebar-user-menu-item"
                onClick={() => {
                  setIsAccountMenuOpen(false)
                  navigate('/account-management')
                }}
              >
                <ChevronUp size={14} />
                <span>微信账号管理</span>
              </button>
            )}
            <button type="button" role="menuitem" className="sidebar-user-menu-item" onClick={openSettings}>
              <Settings size={14} />
              <span>设置</span>
            </button>
          </div>

          <div
            className={`sidebar-user-card ${isAccountMenuOpen ? 'menu-open' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setIsAccountMenuOpen(prev => !prev)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setIsAccountMenuOpen(prev => !prev)
              }
            }}
          >
            <div className="user-avatar">
              {wechatConfigured && userProfile.avatarUrl
                ? <img src={userProfile.avatarUrl} alt="" />
                : <span>{(primaryChannelName || 'W')[0].toUpperCase()}</span>}
            </div>
            <div className="user-meta">
              <div className="user-name">
                {wechatConfigured ? userProfile.displayName : primaryChannelName}
              </div>
              <div className="user-wxid">
                {wechatConfigured ? (userProfile.alias || userProfile.wxid) : channelUserSubtitle}
              </div>
            </div>
            {!collapsed && <span className={`user-menu-caret ${isAccountMenuOpen ? 'open' : ''}`}><ChevronUp size={14} /></span>}
          </div>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
