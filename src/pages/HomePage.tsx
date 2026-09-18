import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MessageCircle, Plus, Send } from 'lucide-react'
import { useChannelStore } from '../stores/channelStore'
import type { ChannelId } from '../../shared/channel'
import './HomePage.scss'

function HomePage() {
  const navigate = useNavigate()
  const enabledChannels = useChannelStore(state => state.enabledChannels)
  const availability = useChannelStore(state => state.availability)
  const initialize = useChannelStore(state => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  const openSetup = (mode: 'initial' | 'add-channel', channel?: ChannelId) => {
    void window.electronAPI.window.openOnboardingWindow({ mode, channel })
  }

  const openChannel = (channel: ChannelId) => {
    if (availability[channel].configured) {
      navigate(channel === 'telegram' ? '/telegram' : '/chat')
      return
    }
    openSetup('add-channel', channel)
  }

  const channels: Array<{ id: ChannelId; title: string; icon: typeof MessageCircle; enabled: boolean }> = [
    { id: 'wechat', title: '微信', icon: MessageCircle, enabled: enabledChannels.includes('wechat') },
    { id: 'telegram', title: 'Telegram', icon: Send, enabled: enabledChannels.includes('telegram') }
  ]

  return (
    <div className="home-page">
      <div className="home-glow animate-breath"></div>
      <div className="home-content">
        <div className="brand-letters">
          {['w', 'e', 'f', 'l', 'o', 'w'].map(char => (
            <span key={char} className="letter">
              <span className="letter-bg">{char}</span>
              <span className="letter-fill-wrapper" style={{ width: '100%' }}>
                <span className="letter-fill-content">{char}</span>
              </span>
            </span>
          ))}
        </div>
        <p className="home-subtitle">本地消息数据工作台</p>

        <div className="home-channel-grid">
          {channels.map(channel => channel.enabled && (
            <button
              key={channel.id}
              type="button"
              className="home-channel-card"
              onClick={() => openChannel(channel.id)}
            >
              <span className="home-channel-icon"><channel.icon size={20} /></span>
              <span className="home-channel-copy">
                <strong>{channel.title}</strong>
                <small>
                  {availability[channel.id].configured ? '已配置' : '待配置'}
                </small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}

          {channels.some(channel => !channel.enabled) && (
            <button type="button" className="home-channel-card add" onClick={() => openSetup('add-channel')}>
              <span className="home-channel-icon"><Plus size={20} /></span>
              <span className="home-channel-copy">
                <strong>添加渠道</strong>
                <small>{enabledChannels.length ? '配置另一个数据来源' : '选择微信或 Telegram'}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default HomePage
