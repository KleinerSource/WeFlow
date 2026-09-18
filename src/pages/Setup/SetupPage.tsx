import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Minus, X } from 'lucide-react'
import * as configService from '../../services/config'
import type { ChannelId, OnboardingSetupMode } from '../../../shared/channel'
import ChannelSelectionStep from './ChannelSelectionStep'
import WeChatSetupWizard from './WeChatSetupWizard'
import TelegramSetupWizard from './TelegramSetupWizard'
import './Setup.scss'

interface SetupPageProps {
  standalone?: boolean
}

const normalizeMode = (value: string | null): OnboardingSetupMode =>
  value === 'add-channel' || value === 'add-wechat-account' || value === 'add-account'
    ? (value === 'add-account' ? 'add-wechat-account' : value)
    : 'initial'

function SetupPage({ standalone = false }: SetupPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(location.search)
  const setupMode = normalizeMode(searchParams.get('mode'))
  const requestedChannel = searchParams.get('channel')
  const initialChannel = requestedChannel === 'wechat' || requestedChannel === 'telegram' ? requestedChannel : null
  const [selectedChannel, setSelectedChannel] = useState<ChannelId | null>(
    initialChannel || (setupMode === 'add-wechat-account' ? 'wechat' : null)
  )
  const [busy, setBusy] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (!initialChannel) return
    void (async () => {
      const enabled: ChannelId[] = Array.from(new Set([...await configService.getEnabledChannels(), initialChannel]))
      await configService.setEnabledChannels(enabled)
      if (setupMode === 'initial') {
        await configService.setActiveChannel(initialChannel)
      }
      await configService.setOnboardingDone(true)
    })()
  }, [initialChannel, setupMode])

  const selectChannel = async (channel: ChannelId) => {
    setBusy(true)
    try {
      const enabled: ChannelId[] = Array.from(new Set([...await configService.getEnabledChannels(), channel]))
      if (setupMode === 'initial') {
        await configService.setActiveChannel(channel)
      }
      await configService.setEnabledChannels(enabled)
      await configService.setOnboardingDone(true)
      setSelectedChannel(channel)
    } finally {
      setBusy(false)
    }
  }

  const complete = (channel: ChannelId, destination: 'home' | ChannelId) => {
    if (standalone) {
      setIsClosing(true)
      window.setTimeout(() => {
        void window.electronAPI.window.completeOnboarding({
          channel,
          setupMode: setupMode === 'initial' ? 'initial' : 'add-channel',
          destination
        })
      }, 450)
      return
    }
    const route = destination === 'home' ? '/home' : destination === 'telegram' ? '/telegram/chat' : '/chat'
    navigate(route)
  }

  return (
    <div className={`welcome-page${isClosing ? ' is-closing' : ''}${standalone ? ' is-standalone' : ''}`}>
      <div className="welcome-container setup-container">
        {standalone && (
          <div className="window-controls">
            <button type="button" className="window-btn" onClick={() => window.electronAPI.window.minimize()} aria-label="最小化">
              <Minus size={14} />
            </button>
            <button type="button" className="window-btn is-close" onClick={() => window.electronAPI.window.close()} aria-label="关闭">
              <X size={14} />
            </button>
          </div>
        )}

        {selectedChannel === 'wechat' ? (
          <WeChatSetupWizard
            addAccountMode={setupMode === 'add-wechat-account'}
            onComplete={destination => complete('wechat', destination)}
          />
        ) : selectedChannel === 'telegram' ? (
          <TelegramSetupWizard onComplete={destination => complete('telegram', destination)} />
        ) : (
          <ChannelSelectionStep onSelect={channel => void selectChannel(channel)} disabled={busy} />
        )}
      </div>
    </div>
  )
}

export default SetupPage
