import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { TelegramStore } from './telegramStore.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('Telegram HTTP API 使用现有鉴权并隔离导入源', async () => {
  await stat(join(root, 'dist-electron', 'main.js'))
  const profile = await mkdtemp(join(tmpdir(), 'weflow-telegram-http-integration-'))
  let child
  try {
    const port = await freePort()
    const token = 'telegram-http-test-token'
    const store = new TelegramStore(join(profile, 'telegram'))
    const chat = { id: 'private_group:42', title: '测试群', kind: 'private_group', lastMessageAt: 102, unreadCount: 0, messageCount: 3, complete: true }
    const sourceId = await store.importExport('测试导入', profile, [{ chat, messages: [
      { id: 1, date: 100, sender: '甲', text: '第一条', kind: 'text', outgoing: false },
      { id: 2, date: 100, sender: '乙', text: '第二条', kind: 'photo', outgoing: false, mediaPath: join(profile, 'private.jpg') },
      { id: 3, date: 102, sender: '甲', text: '第三条', kind: 'text', outgoing: false }
    ] }])
    const otherSourceId = await store.importExport('另一份导入', profile, [{ chat: { ...chat, title: '对照群' }, messages: [
      { id: 9, date: 103, sender: '丙', text: '另一份记录', kind: 'text', outgoing: false }
    ] }])
    await writeFile(join(profile, 'WeFlow-config.json'), JSON.stringify({
      onboardingDone: true,
      silentStartup: true,
      httpApiEnabled: true,
      httpApiPort: port,
      httpApiHost: '127.0.0.1',
      httpApiToken: token
    }), 'utf8')

    let logs = ''
    child = spawn(require('electron'), ['.', `--user-data-dir=${profile}`], {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        WEFLOW_CONFIG_CWD: profile,
        WEFLOW_USER_DATA_PATH: profile,
        VITE_DEV_SERVER_URL: pathToFileURL(join(root, 'dist', 'index.html')).href,
        AUTO_UPDATE_ENABLED: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-2000) })
    child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-2000) })

    const base = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) break
      try {
        const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })
        if (health.ok) { ready = true; break }
      } catch {}
      await delay(250)
    }
    assert.ok(ready, `HTTP API did not start: ${logs}`)

    const endpoint = `/api/v1/telegram/sources/${sourceId}`
    const request = async (path, options = {}) => {
      const response = await fetch(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } })
      return { status: response.status, body: await response.json() }
    }
    assert.equal((await fetch(`${base}/api/v1/telegram/sources`)).status, 401)
    assert.equal((await fetch(`${base}/api/v1/sessions?format=chatlab`)).status, 401)
    const sources = await request('/api/v1/telegram/sources')
    assert.equal(sources.status, 200)
    assert.equal(sources.body.sources.length, 2)
    assert.equal(sources.body.sources.find(item => item.id === sourceId).chatCount, 1)
    assert.equal(sources.body.sources.find(item => item.id === otherSourceId).chatCount, 1)

    const checked = await request('/api/v1/sessions?format=chatlab&limit=1')
    assert.equal(checked.status, 200)
    assert.equal(checked.body.sessions.length, 1)
    const discovered = await request('/api/v1/sessions?format=chatlab&limit=200')
    assert.equal(discovered.status, 200)
    assert.equal(discovered.body.sessions.length, 2)
    const discoveredChat = discovered.body.sessions.find(item => item.name === '测试群')
    const otherChat = discovered.body.sessions.find(item => item.name === '对照群')
    assert.ok(discoveredChat)
    assert.ok(otherChat)
    assert.notEqual(discoveredChat.id, otherChat.id)
    assert.match(discoveredChat.id, /^tg\./)
    const rootPull = `/api/v1/sessions/${discoveredChat.id}/messages`
    const rootFirst = await request(`${rootPull}?format=chatlab&limit=1`)
    assert.equal(rootFirst.status, 200)
    assert.equal(rootFirst.body.meta.platform, 'telegram')
    assert.deepEqual(rootFirst.body.messages.map(message => message.platformMessageId), ['1'])
    assert.equal(rootFirst.body.sync.nextSince, undefined)
    assert.equal(rootFirst.body.sync.nextOffset, 1)
    const rootSecond = await request(`${rootPull}?format=chatlab&limit=1&offset=${rootFirst.body.sync.nextOffset}`)
    assert.deepEqual(rootSecond.body.messages.map(message => message.platformMessageId), ['2'])
    assert.equal(rootSecond.body.sync.nextSince, undefined)
    const rootLast = await request(`${rootPull}?format=chatlab&limit=1&offset=${rootSecond.body.sync.nextOffset}`)
    assert.deepEqual(rootLast.body.messages.map(message => message.platformMessageId), ['3'])
    assert.equal(rootLast.body.sync.hasMore, false)
    assert.equal(rootLast.body.sync.nextSince, 102)
    const rootMessage = await request(`/api/v1/messages?talker=${encodeURIComponent(discoveredChat.id)}&format=chatlab`)
    assert.equal(rootMessage.body.meta.platform, 'telegram')
    const otherPull = await request(`/api/v1/sessions/${otherChat.id}/messages?format=chatlab`)
    assert.deepEqual(otherPull.body.messages.map(message => message.platformMessageId), ['9'])
    assert.equal((await request('/api/v1/sessions/tg.live.invalid/messages?format=chatlab')).status, 400)
    assert.equal((await request('/api/v1/sessions/tg.live.YQ/messages?format=chatlab')).status, 404)

    const sessions = await request(`${endpoint}/sessions?format=chatlab`)
    assert.equal(sessions.status, 200)
    assert.equal(sessions.body.sessions[0].platform, 'telegram')
    assert.equal(sessions.body.sessions[0].type, 'group')
    const raw = await request(`${endpoint}/messages?talker=private_group%3A42&limit=2`)
    assert.deepEqual(raw.body.messages.map(message => message.id), [3, 2])
    assert.equal(raw.body.hasMore, true)
    assert.equal(raw.body.messages[1].mediaPath, undefined)
    const chatlab = await request(`${endpoint}/messages?talker=private_group%3A42&format=chatlab&limit=1`)
    assert.equal(chatlab.body.meta.platform, 'telegram')
    assert.equal(chatlab.body.complete, true)
    assert.equal(chatlab.body.messages[0].platformMessageId, '3')
    const posted = await request(`${endpoint}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talker: chat.id, keyword: '第二条' })
    })
    assert.deepEqual(posted.body.messages.map(message => message.id), [2])
    const pullPath = `${endpoint}/sessions/private_group%3A42/messages`
    const first = await request(`${pullPath}?limit=2`)
    assert.deepEqual(first.body.messages.map(message => message.platformMessageId), ['1', '2'])
    assert.equal(first.body.sync.nextOffset, 2)
    const second = await request(`${pullPath}?limit=2&offset=2`)
    assert.deepEqual(second.body.messages.map(message => message.platformMessageId), ['3'])
    assert.equal(second.body.sync.hasMore, false)

    assert.equal((await request('/api/v1/telegram/sources/invalid/sessions')).status, 400)
    assert.equal((await request('/api/v1/telegram/sources/live/sessions')).status, 404)
    assert.equal((await request(`${endpoint}/messages?talker=missing`)).status, 404)
    assert.equal((await request(`${endpoint}/messages?talker=private_group%3A42&media=1`)).status, 400)
    assert.equal((await request(`${pullPath}?media=1`)).status, 400)
    assert.equal((await request('/api/v1/telegram/sources', { method: 'POST' })).status, 405)

    const manyChats = Array.from({ length: 5001 }, (_, index) => ({
      id: `bulk:${index}`,
      title: `批量会话 ${index}`,
      kind: index === 0 ? 'channel' : 'personal_chat',
      lastMessageAt: 1000 + index,
      unreadCount: 0,
      messageCount: 0,
      complete: false
    }))
    await store.updateLive('在线账号', manyChats)
    const firstPage = await request('/api/v1/sessions?format=chatlab&keyword=telegram&limit=200')
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.body.sessions.length, 200)
    assert.ok(firstPage.body.sessions.every(item => item.platform === 'telegram'))
    assert.equal(firstPage.body.page.hasMore, true)
    assert.ok(firstPage.body.page.nextCursor)
    const secondPage = await request(`/api/v1/sessions?format=chatlab&keyword=telegram&limit=200&cursor=${firstPage.body.page.nextCursor}`)
    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.body.sessions.length, 200)
    assert.equal(new Set([...firstPage.body.sessions, ...secondPage.body.sessions].map(item => item.id)).size, 400)

    const largePage = await request('/api/v1/sessions?format=chatlab&platform=telegram&limit=5000')
    assert.equal(largePage.body.sessions.length, 5000)
    assert.equal(largePage.body.page.hasMore, true)
    const lastPage = await request(`/api/v1/sessions?format=chatlab&platform=telegram&limit=5000&cursor=${largePage.body.page.nextCursor}`)
    assert.equal(lastPage.body.sessions.length, 3)
    assert.equal(lastPage.body.page.hasMore, false)
    assert.equal(lastPage.body.sessions.find(item => item.id === discoveredChat.id)?.name, '测试群')
    assert.equal((await request('/api/v1/sessions?format=chatlab&keyword=wechat&limit=200')).body.sessions.length, 0)
    assert.equal((await request('/api/v1/sessions?format=chatlab&keyword=%E6%89%B9%E9%87%8F%E4%BC%9A%E8%AF%9D%204999&platform=telegram')).body.sessions.length, 1)
    const channel = await request('/api/v1/sessions?format=chatlab&platform=telegram&keyword=%E6%89%B9%E9%87%8F%E4%BC%9A%E8%AF%9D%200')
    assert.equal(channel.body.sessions.length, 1)
    assert.equal(channel.body.sessions[0].type, 'channel')
    const channelMessages = Array.from({ length: 5999 }, (_, index) => ({
      id: index + 1,
      date: 2000 + Math.floor(index / 10),
      sender: '测试账号',
      text: `消息 ${index + 1}`,
      kind: 'text',
      outgoing: false
    }))
    await store.upsertMessages('live', 'bulk:0', channelMessages)
    const refreshedChannel = await request('/api/v1/sessions?format=chatlab&platform=telegram&keyword=%E6%89%B9%E9%87%8F%E4%BC%9A%E8%AF%9D%200')
    assert.equal(refreshedChannel.body.sessions[0].messageCount, 5999)
    let messageOffset = 0
    const receivedIds = new Set()
    for (;;) {
      const result = await request(`/api/v1/sessions/${refreshedChannel.body.sessions[0].id}/messages?format=chatlab&limit=1000&offset=${messageOffset}`)
      assert.equal(result.status, 200)
      for (const message of result.body.messages) receivedIds.add(message.platformMessageId)
      if (!result.body.sync.hasMore) break
      assert.equal(result.body.sync.nextOffset, messageOffset + result.body.messages.length)
      messageOffset = result.body.sync.nextOffset
    }
    assert.equal(receivedIds.size, 5999)
    assert.equal((await request('/api/v1/sessions?format=chatlab&platform=invalid')).status, 400)
    assert.equal((await request('/api/v1/sessions?format=chatlab&cursor=invalid')).status, 400)
    assert.equal((await request(`/api/v1/sessions?format=chatlab&keyword=wechat&cursor=${firstPage.body.page.nextCursor}`)).status, 400)
  } finally {
    if (child && child.exitCode === null) {
      child.kill()
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000, undefined, { ref: false })])
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
