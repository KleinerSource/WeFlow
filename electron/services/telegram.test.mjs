import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseTelegramExport } from './telegramExport.ts'
import { TelegramStore } from './telegramStore.ts'
import { canPersistTelegramSession } from './telegramStorage.ts'
import { listTelegramSessions, pageTelegramMessages, parseTelegramPullSessionId, publicTelegramMessages, telegramPullSessionId, toTelegramChatLab } from './telegramHttp.ts'

test('Windows 运行时没有存储后端查询方法时仍可读取状态', () => {
  assert.equal(canPersistTelegramSession({ isEncryptionAvailable: () => true }), true)
  assert.equal(canPersistTelegramSession({ isEncryptionAvailable: () => false }), false)
  assert.equal(canPersistTelegramSession({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }), false)
})

test('解析完整导出中的富文本、媒体及会话', () => {
  const data = parseTelegramExport({
    chats: { list: [{ id: 123, name: '项目群', type: 'private_group', messages: [
      { id: 2, date_unixtime: '1700000002', from: '李四', media_type: 'video_file', file: 'video/a.mp4', text: ['A', { type: 'bold', text: 'B' }] },
      { id: 1, date: '2023-11-14T22:13:20', from: '张三', text: '你好' }
    ] }] }
  }, '张三')
  assert.equal(data.length, 1)
  assert.equal(data[0].chat.messageCount, 2)
  assert.equal(data[0].chat.id, 'private_group:123')
  assert.deepEqual(data[0].messages.map(item => item.id), [1, 2])
  assert.equal(data[0].messages[0].outgoing, true)
  assert.equal(data[0].messages[1].text, 'AB')
  assert.equal(data[0].messages[1].kind, 'video_file')
})

test('接受单个聊天导出，拒绝其他 JSON', () => {
  assert.equal(parseTelegramExport({ name: '单聊', messages: [{ id: 3, date_unixtime: '1700000000', text: 'hi' }] })[0].chat.title, '单聊')
  assert.equal(parseTelegramExport({ name: '单聊', messages: [{ id: 3, from_id: 'user42', text: 'hi' }] }, '', '42')[0].messages[0].outgoing, true)
  assert.throws(() => parseTelegramExport({ chats: {} }), /chats.list/)
})

test('缓存按会话隔离、去重，并拒绝越界媒体路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weflow-telegram-test-'))
  try {
    const store = new TelegramStore(root)
    const chat = { id: '1', title: '私聊', kind: 'personal_chat', lastMessageAt: 0, unreadCount: 0, messageCount: 0, complete: true }
    const message = { id: 1, date: 100, sender: '甲', text: '旧', kind: 'text', outgoing: false }
    const sourceId = await store.importExport('记录', root, [{ chat, messages: [{ ...message, mediaPath: '../outside.png' }] }])
    assert.equal((await store.getMessages(sourceId, '1'))[0].mediaPath, undefined)
    await store.upsertMessages(sourceId, '1', [{ ...message, text: '新' }])
    assert.equal((await store.getMessages(sourceId, '1')).length, 1)
    assert.equal((await store.getMessages(sourceId, '1'))[0].text, '新')
    await store.upsertMessages(sourceId, '1', [{ ...message, mediaPath: join(root, 'inside.png') }])
    await store.upsertMessages(sourceId, '1', [{ ...message, text: '编辑后' }])
    assert.equal((await store.getMessages(sourceId, '1'))[0].mediaPath, join(root, 'inside.png'))
    await store.removeMessages(sourceId, '1', [1])
    assert.equal((await store.getMessages(sourceId, '1')).length, 0)
    assert.equal((await store.listSources()).length, 1)
    assert.rejects(() => store.getMessages('../', '1'), /无效的数据源/)
    await store.removeImport(sourceId)
    assert.equal((await store.listSources()).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('通讯录与资源浏览按真实消息聚合', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weflow-telegram-views-test-'))
  try {
    const store = new TelegramStore(root)
    const chat = { id: 'group:1', title: '项目群', kind: 'group', lastMessageAt: 120, unreadCount: 0, messageCount: 0, complete: true }
    const messages = [
      { id: 1, date: 100, sender: '甲', text: '文本', kind: 'text', outgoing: false },
      { id: 2, date: 110, sender: '我', text: '图片', kind: 'photo', outgoing: true, mediaPath: 'inside.png' },
      { id: 3, date: 120, sender: '乙', text: '语音', kind: 'voice_message', outgoing: false }
    ]
    const sourceId = await store.importExport('记录', root, [{ chat, messages }])
    assert.deepEqual((await store.listContacts(sourceId)).map(contact => ({
      name: contact.name,
      messageCount: contact.messageCount,
      chatCount: contact.chatCount,
      outgoing: contact.outgoing
    })), [
      { name: '乙', messageCount: 1, chatCount: 1, outgoing: false },
      { name: '我', messageCount: 1, chatCount: 1, outgoing: true },
      { name: '甲', messageCount: 1, chatCount: 1, outgoing: false }
    ])
    assert.deepEqual((await store.listResources(sourceId)).map(resource => ({
      chatTitle: resource.chatTitle,
      kind: resource.kind,
      mediaPath: resource.mediaPath
    })), [
      { chatTitle: '项目群', kind: 'voice_message', mediaPath: undefined },
      { chatTitle: '项目群', kind: 'photo', mediaPath: join(root, 'inside.png') }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tdata 授权只可复用匹配的在线缓存，不覆盖无法确认的账号', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weflow-tdata-isolation-'))
  try {
    const store = new TelegramStore(root)
    const chat = { id: '1', title: '原账号', kind: 'personal_chat', lastMessageAt: 0, unreadCount: 0, messageCount: 0, complete: false }
    await store.updateLive('原账号', [chat], '123')
    await store.assertLiveAccount('123')
    await assert.rejects(store.assertLiveAccount('456'), /在线缓存/)
    assert.equal((await store.getSource('live')).accountId, '123')
    assert.equal((await store.getSource('live')).chats[0].title, '原账号')
    await store.updateLive('原账号', [], '123')
    await assert.rejects(store.assertLiveAccount('456'), /在线缓存/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('HTTP 会话按在线账号和导入文件隔离，映射 ChatLab 平台与类型', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weflow-telegram-http-test-'))
  try {
    const store = new TelegramStore(root)
    const liveChat = { id: 'private_group:42', title: '在线群', kind: 'group', lastMessageAt: 100, unreadCount: 1, messageCount: 0, complete: false }
    const importChat = { ...liveChat, title: '导入群', kind: 'private_group', complete: true }
    await store.updateLive('在线账号', [liveChat])
    const importId = await store.importExport('导入记录', root, [{ chat: importChat, messages: [
      { id: 1, date: 100, sender: '甲', text: '导入消息', kind: 'text', outgoing: false }
    ] }])
    const [live, imported] = await Promise.all([store.getSource('live'), store.getSource(importId)])
    assert.equal(listTelegramSessions(live, '在线', 10, false).sessions[0].title, '在线群')
    assert.equal(listTelegramSessions(imported, '在线', 10, false).count, 0)
    assert.deepEqual(listTelegramSessions(imported, '导入', 10, true).sessions[0], {
      id: 'private_group:42', name: '导入群', platform: 'telegram', type: 'group', messageCount: 0, lastMessageAt: 100, complete: true
    })
    assert.equal((await store.getMessages(importId, importChat.id))[0].text, '导入消息')
    assert.deepEqual(await store.getMessages('live', liveChat.id), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ChatLab 根路径的 Telegram 会话 ID 包含源并可安全还原', () => {
  const id = telegramPullSessionId('live', '群/组 %42')
  assert.deepEqual(parseTelegramPullSessionId(id), { sourceId: 'live', chatId: '群/组 %42' })
  assert.equal(id.includes('/'), false)
  assert.equal(parseTelegramPullSessionId('tg.live.!!'), null)
  assert.equal(parseTelegramPullSessionId('tg.invalid.YQ'), null)
  assert.equal(parseTelegramPullSessionId('wxid_original'), null)
  assert.notEqual(telegramPullSessionId('live', '42'), telegramPullSessionId('import-00000000-0000-0000-0000-000000000001', '42'))
})

test('频道仅在 ChatLab 格式中兼容为群聊，原始类型仍是频道', () => {
  for (const kind of ['channel', 'public_channel']) {
    const chat = { id: 'channel:42', title: '公告频道', kind, lastMessageAt: 100, unreadCount: 0, messageCount: 2, complete: false }
    const source = { id: 'live', label: '我', kind: 'account', chats: [chat] }
    assert.equal(listTelegramSessions(source, '', 10, false).sessions[0].kind, kind)
    assert.equal(listTelegramSessions(source, '', 10, true).sessions[0].type, 'group')
    const pulled = toTelegramChatLab(source, chat, [{ id: 1, date: 100, sender: '我', text: '公告', kind: 'text', outgoing: true }])
    assert.equal(pulled.meta.type, 'group')
    assert.equal(pulled.meta.groupId, chat.id)
    assert.equal(pulled.meta.platform, 'telegram')
  }
})

test('HTTP 消息按时间、关键词与偏移分页，不暴露本机媒体路径', () => {
  const source = { id: 'live', label: '我', kind: 'account', chats: [] }
  const chat = { id: 'group:1', title: '群', kind: 'group', lastMessageAt: 120, unreadCount: 0, messageCount: 3, complete: false }
  const messages = [
    { id: 1, date: 100, sender: '甲', text: '开始', kind: 'text', outgoing: false },
    { id: 2, date: 110, sender: '', text: '图片', kind: 'photo', outgoing: true, mediaPath: 'C:\\private\\photo.jpg' },
    { id: 3, date: 120, sender: '乙', text: '图片已收', kind: 'text', outgoing: false }
  ]
  const first = pageTelegramMessages(messages, { start: 100, end: 120, keyword: '图片', offset: 0, limit: 1, ascending: false })
  assert.equal(first.hasMore, true)
  assert.equal(first.messages[0].id, 3)
  const second = pageTelegramMessages(messages, { start: 100, end: 120, keyword: '图片', offset: 1, limit: 1, ascending: false })
  assert.equal(second.hasMore, false)
  assert.deepEqual(publicTelegramMessages(second.messages)[0], { id: 2, date: 110, sender: '', text: '图片', kind: 'photo', outgoing: true })
  const pull = pageTelegramMessages(messages, { start: 100, end: 0, offset: 0, limit: 2, ascending: true })
  assert.deepEqual(pull.messages.map(message => message.id), [1, 2])
  assert.equal(pull.hasMore, true)
  const data = toTelegramChatLab(source, chat, pull.messages)
  assert.equal(data.meta.platform, 'telegram')
  assert.equal(data.meta.type, 'group')
  assert.equal(data.messages[1].type, 1)
  assert.equal(data.messages[1].sender, '我')
  assert.deepEqual(data.members.map(member => member.platformId), ['甲', '我'])
  assert.equal(JSON.stringify(data).includes('C:\\private'), false)
  assert.deepEqual(messages.map(message => message.id), [1, 2, 3])
})
