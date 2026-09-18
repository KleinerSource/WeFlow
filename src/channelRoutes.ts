import type { ChannelId } from '../shared/channel'

export const WECHAT_ROUTES = [
  '/chat',
  '/sns',
  '/biz',
  '/contacts',
  '/resources',
  '/footprint',
  '/export',
  '/backup',
  '/account-management'
]

export const TELEGRAM_ROUTES = [
  '/telegram/chat',
  '/telegram/contacts',
  '/telegram/resources',
  '/telegram/export'
]

export const routeChannel = (pathname: string): ChannelId | null => {
  if (pathname.startsWith('/chat-history/') || pathname.startsWith('/chat-history-inline/')) return 'wechat'
  if (pathname === '/telegram' || TELEGRAM_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))) return 'telegram'
  return WECHAT_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`)) ? 'wechat' : null
}

export const channelHomeRoute = (channel: ChannelId): string =>
  channel === 'telegram' ? '/telegram/chat' : '/chat'
