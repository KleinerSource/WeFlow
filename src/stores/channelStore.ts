import { create } from 'zustand'
import * as configService from '../services/config'
import { useAppStore } from './appStore'
import type { ChannelAvailability, ChannelId } from '../../shared/channel'

interface ChannelState {
  activeChannel: ChannelId | null
  enabledChannels: ChannelId[]
  availability: Record<ChannelId, ChannelAvailability>
  isLoaded: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
}

const normalizeChannels = (value: unknown): ChannelId[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ChannelId => item === 'wechat' || item === 'telegram')
}

const readWeChatConfig = async () => {
  const [dbPath, decryptKey, myWxid] = await Promise.all([
    configService.getDbPath(),
    configService.getDecryptKey(),
    configService.getMyWxid()
  ])
  return Boolean(dbPath && decryptKey && myWxid)
}

const readTelegramConfig = async () => {
  try {
    const [status, sources] = await Promise.all([
      window.electronAPI.telegram.status(),
      window.electronAPI.telegram.sources()
    ])
    return {
      configured: status.connected || status.hasSavedSession || sources.length > 0,
      connected: status.connected || sources.length > 0
    }
  } catch {
    return { configured: false, connected: false }
  }
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  activeChannel: null,
  enabledChannels: [],
  availability: {
    wechat: { enabled: false, configured: false, connected: false },
    telegram: { enabled: false, configured: false, connected: false }
  },
  isLoaded: false,

  initialize: async () => {
    if (get().isLoaded) {
      await get().refresh()
      return
    }
    await get().refresh()
    set({ isLoaded: true })
  },

  refresh: async () => {
    const [savedActive, savedEnabled, wechatConfigured, telegram] = await Promise.all([
      configService.getActiveChannel(),
      configService.getEnabledChannels(),
      readWeChatConfig(),
      readTelegramConfig()
    ])

    const configuredChannels = new Set<ChannelId>([
      ...(wechatConfigured ? (['wechat'] as ChannelId[]) : []),
      ...(telegram.configured ? (['telegram'] as ChannelId[]) : [])
    ])
    const enabled = normalizeChannels(savedEnabled)
    const nextEnabled = Array.from(new Set([
      ...enabled,
      ...(wechatConfigured ? (['wechat'] as ChannelId[]) : []),
      ...(telegram.configured ? (['telegram'] as ChannelId[]) : [])
    ]))
    if (nextEnabled.length !== enabled.length) {
      await configService.setEnabledChannels(nextEnabled)
    }

    const active = savedActive && nextEnabled.includes(savedActive)
      ? savedActive
      : nextEnabled.find(channel => configuredChannels.has(channel)) || nextEnabled[0] || null
    if (active !== savedActive) {
      await configService.setActiveChannel(active)
    }

    const isWeChatConnected = useAppStore.getState().isDbConnected
    set({
      activeChannel: active,
      enabledChannels: enabled,
      availability: {
        wechat: { enabled: nextEnabled.includes('wechat'), configured: wechatConfigured, connected: wechatConfigured && isWeChatConnected },
        telegram: { enabled: nextEnabled.includes('telegram'), configured: telegram.configured, connected: telegram.connected }
      }
    })
  },

}))
