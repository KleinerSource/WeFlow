export type ChannelId = 'wechat' | 'telegram'

export interface ChannelAvailability {
  enabled: boolean
  configured: boolean
  connected: boolean
}

export type OnboardingSetupMode = 'initial' | 'add-channel' | 'add-wechat-account'

export interface CompleteOnboardingPayload {
  channel: ChannelId
  setupMode?: 'initial' | 'add-channel'
  destination?: 'home' | ChannelId
}

export interface OpenOnboardingOptions {
  mode?: OnboardingSetupMode | 'add-account'
  channel?: ChannelId
}
