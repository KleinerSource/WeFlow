import { MessageCircle, Send } from 'lucide-react'
import type { ChannelId } from '../../../shared/channel'

interface ChannelSelectionStepProps {
  onSelect: (channel: ChannelId) => void
  disabled?: boolean
}

function ChannelSelectionStep({ onSelect, disabled = false }: ChannelSelectionStepProps) {
  const channels = [
    {
      id: 'wechat' as const,
      title: '微信',
      desc: '连接本机微信数据库，导入聊天、联系人与朋友圈数据。',
      icon: MessageCircle
    },
    {
      id: 'telegram' as const,
      title: 'Telegram',
      desc: '登录账号或导入 Desktop JSON，同步聊天与频道数据。',
      icon: Send
    }
  ]

  return (
    <section className="setup-channel-step">
      <div className="setup-channel-header">
        <h2>选择数据渠道</h2>
        <p>先选择本次要使用的渠道，配置可以稍后继续完成。</p>
      </div>

      <div className="setup-channel-grid">
        {channels.map(channel => (
          <button
            key={channel.id}
            type="button"
            className="setup-channel-card"
            onClick={() => onSelect(channel.id)}
            disabled={disabled}
          >
            <span className="setup-channel-icon"><channel.icon size={26} /></span>
            <span className="setup-channel-copy">
              <strong>{channel.title}</strong>
              <small>{channel.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default ChannelSelectionStep
