import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { routeChannel } from '../channelRoutes'
import { useChannelStore } from '../stores/channelStore'

interface RouteGuardProps {
  children: React.ReactNode
}

function RouteGuard({ children }: RouteGuardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isLoaded = useChannelStore(state => state.isLoaded)
  const enabledChannels = useChannelStore(state => state.enabledChannels)
  const availability = useChannelStore(state => state.availability)

  useEffect(() => {
    if (!isLoaded) return
    const channel = routeChannel(location.pathname)
    if (!channel || enabledChannels.includes(channel)) {
      if (channel !== 'wechat' || availability.wechat.configured) return
    }
    navigate('/home', { replace: true })
  }, [availability.wechat.configured, enabledChannels, isLoaded, location.pathname, navigate])

  return <>{children}</>
}

export default RouteGuard
