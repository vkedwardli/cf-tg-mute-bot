const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { test } = require('node:test')
const ts = require('typescript')

// Load the worker using the project's existing TypeScript compiler, without a test framework.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  })
  module._compile(outputText, filename)
}
const worker = require('../src/worker.ts').default
delete require.extensions['.ts']

const suffix = '驗證都唔撳，九成係騙子。已清理，世界線穩定。'
const chat = { id: -100, username: 'GundamDX', type: 'supergroup' }
const user = { id: 1, first_name: 'Player', is_bot: false }

// Execute the actual D1 SQL against SQLite instead of mocking queries or their results.
function d1(sqlite) {
  return {
    prepare(sql) {
      let values = []
      return {
        bind(...args) {
          values = args
          return this
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values)
          return { success: true, meta: { changes: result.changes } }
        },
        async all() {
          return { success: true, results: sqlite.prepare(sql).all(...values) }
        },
        async first() {
          return sqlite.prepare(sql).get(...values) ?? null
        },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
  }
}

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(resolve(__dirname, '../schema/schema.sql'), 'utf8'))
  t.after(() => sqlite.close())
  const env = {
    DB: d1(sqlite),
    TG_BOT_TOKEN: 'test-token',
    TG_HOOK_SECRET: 'test-secret',
    TG_BOT_USERNAME: 'DXMuteBot',
    TG_ALLOWED_CHAT_USERNAMES: 'GundamDX,edwardli',
    TG_SPAM_RE: 'SPAM',
    TG_ROSE_BOT_USERNAME: 'MissRose_bot',
    TG_ROSE_CAPTCHA_WELCOME_PREFIX: '歡迎新血加入，請細讀以下事項：',
    TG_ROSE_CAPTCHA_MATCH_WINDOW: 30,
    TG_ROSE_CAPTCHA_CLEANUP_DELAY: 300,
    TG_ROSE_CAPTCHA_MAX_PENDING_AGE: 900,
    TG_ROSE_CAPTCHA_CLEANUP_ANNOUNCEMENT_TEMPLATE: `{displayNames}${suffix}`,
    TG_SILENCE_CONSENSUS_POLL_DURATION: 86400,
  }
  const calls = []
  const errors = []
  const statuses = new Map()
  const messages = new Map()
  const failures = new Map()
  const hooks = new Map()
  let nextMessageId = 100
  let nextUserId = 10
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', (...args) => errors.push(args))
  t.mock.method(globalThis, 'fetch', async (request) => {
    const method = new URL(request.url).pathname.split('/').at(-1)
    const payload = JSON.parse(await request.text())
    calls.push({ method, ...payload })
    const hook = hooks.get(method)
    if (hook) {
      hooks.delete(method)
      await hook(payload)
    }
    const failure = failures.get(method)?.shift()
    if (failure) return Response.json({ ok: false, description: failure })
    let result
    const key = `${payload.chat_id}:${payload.message_id}`
    if (method === 'getChatMember') {
      result = statuses.get(payload.user_id) ?? { status: 'left' }
    } else if (method === 'deleteMessage') {
      messages.delete(key)
      result = true
    } else if (method === 'banChatMember') {
      result = true
    } else if (method === 'sendMessage') {
      result = { message_id: nextMessageId++, text: payload.text }
      messages.set(`${payload.chat_id}:${result.message_id}`, result)
    } else if (method === 'editMessageText') {
      if (!messages.has(key)) return Response.json({ ok: false, description: 'Bad Request: message to edit not found' })
      result = { message_id: payload.message_id, text: payload.text }
      messages.set(key, result)
    } else {
      throw new Error(`Unexpected Telegram call: ${method}`)
    }
    return Response.json({ ok: true, result })
  })

  return {
    env,
    sqlite,
    calls,
    errors,
    statuses,
    messages,
    failures,
    hooks,
    announcements: () => calls.filter(({ method }) => method === 'sendMessage' || method === 'editMessageText'),
    state: (cid = chat.id) => sqlite.prepare('SELECT * FROM join_cleanup_announcement WHERE chat_id = ?').get(cid),
    pending: () => sqlite.prepare('SELECT * FROM pending_join_cleanup WHERE processed = false').all(),
    addJoin(name, { cid = chat.id, age = 400, welcome = false, status } = {}) {
      const uid = nextUserId++
      const mid = nextMessageId++
      const welcomeId = welcome ? nextMessageId++ : null
      sqlite
        .prepare(
          `INSERT INTO pending_join_cleanup (chat_id, user_id, display_name, join_message_id, rose_welcome_message_id, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(cid, uid, name, mid, welcomeId, Date.now() / 1000 - age)
      if (status) statuses.set(uid, status)
      return { uid, mid, welcomeId }
    },
    async receive(fields = {}, updateField = 'message') {
      const message = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, from: user, ...fields }
      nextMessageId = Math.max(nextMessageId, message.message_id + 1)
      const response = await worker.fetch(
        new Request('https://worker.test', {
          method: 'POST',
          headers: { 'x-telegram-bot-api-secret-token': env.TG_HOOK_SECRET },
          body: JSON.stringify({ update_id: message.message_id, [updateField]: message }),
        }),
        env,
        {},
      )
      assert.equal(response.status, 200)
      return message
    },
    async tick() {
      const tasks = []
      await worker.scheduled({}, env, { waitUntil: (task) => tasks.push(task) })
      await Promise.all(tasks)
    },
  }
}

test('batches failed joins and appends later failures to the same persisted message', async (t) => {
  const f = fixture(t)
  const first = f.addJoin('小鱼吃虾米 高尚禮', { welcome: true })
  const second = f.addJoin('Darlene Nar')
  await f.tick()
  assert.deepEqual(
    f.announcements().map(({ method }) => method),
    ['sendMessage'],
  )
  assert.equal(
    f.announcements()[0].text,
    `「<a href="tg://user?id=${first.uid}">小鱼吃虾米 高尚禮</a>」，「<a href="tg://user?id=${second.uid}">Darlene Nar</a>」${suffix}`,
  )
  assert.deepEqual(
    f.calls.filter(({ method }) => method === 'deleteMessage').map(({ message_id }) => message_id),
    [first.mid, first.welcomeId, second.mid],
  )
  const mid = f.state().message_id

  f.addJoin('Hana Sey')
  await f.tick()
  const edit = f.announcements().at(-1)
  assert.equal(edit.method, 'editMessageText')
  assert.equal(edit.message_id, mid)
  assert.equal(edit.parse_mode, 'HTML')
  assert.match(edit.text, /Darlene Nar.*Hana Sey/)
  assert.equal(f.messages.size, 1)
  assert.equal(f.pending().length, 0)
  await f.tick()
  assert.equal(f.announcements().length, 2)
  assert.deepEqual(f.errors, [])
})

test('join/leave notices, Rose welcomes, deleted spam, and old updates keep the summary open', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.tick()
  await f.receive({ new_chat_members: [{ id: 800, is_bot: false, first_name: 'Newcomer' }] })
  await f.receive({ from: { id: 900, is_bot: true, username: 'MissRose_bot' }, text: f.env.TG_ROSE_CAPTCHA_WELCOME_PREFIX })
  await f.receive({ left_chat_member: { id: 800, is_bot: false, first_name: 'Newcomer' } })
  await f.receive({ text: 'SPAM' })
  await f.receive({ message_id: 1, text: 'An old delayed update' })
  f.addJoin('Second')
  await f.tick()
  assert.equal(f.announcements().at(-1).method, 'editMessageText')
  assert.match(f.announcements().at(-1).text, /First.*Second/)
  assert.equal(f.messages.size, 1)
})

for (const [kind, fields, updateField] of [
  ['text', { text: '打機' }],
  ['photo', { photo: [{ file_id: 'photo', width: 10, height: 10 }] }],
  ['sticker', { sticker: { file_id: 'sticker', width: 10, height: 10 } }],
  ['another bot', { from: { id: 900, is_bot: true, username: 'YoutubeWatcher' }, text: 'A new video' }],
  ['channel post', { from: undefined, text: 'A channel post' }, 'channel_post'],
]) {
  test(`${kind} starts a new summary, excluding earlier names`, async (t) => {
    const f = fixture(t)
    f.addJoin('Before')
    await f.tick()
    const oldMid = f.state().message_id
    await f.receive(fields, updateField)
    // A delayed older update must not overwrite the newer activity marker.
    await f.receive({ message_id: 1, text: 'Old' })
    f.addJoin('After')
    await f.tick()
    assert.equal(f.announcements().at(-1).method, 'sendMessage')
    assert.doesNotMatch(f.announcements().at(-1).text, /Before/)
    assert.match(f.announcements().at(-1).text, /After/)
    assert.notEqual(f.state().message_id, oldMid)
    assert.equal(f.messages.size, 2)
  })
}

test('summaries and chat activity stay isolated by chat', async (t) => {
  const f = fixture(t)
  f.addJoin('Chat one')
  f.addJoin('Chat two', { cid: -200 })
  await f.tick()
  await f.receive({ text: 'Hello', chat: { id: -200, username: 'edwardli', type: 'supergroup' } })
  f.addJoin('Still quiet')
  f.addJoin('After chat', { cid: -200 })
  await f.tick()
  assert.equal(
    f
      .announcements()
      .filter(({ chat_id }) => chat_id === -100)
      .at(-1).method,
    'editMessageText',
  )
  assert.equal(
    f
      .announcements()
      .filter(({ chat_id }) => chat_id === -200)
      .at(-1).method,
    'sendMessage',
  )
  assert.doesNotMatch(
    f
      .announcements()
      .filter(({ chat_id }) => chat_id === -100)
      .at(-1).text,
    /Chat two|After chat/,
  )
})

test('escapes names on both sends and edits, preserving user links', async (t) => {
  const f = fixture(t)
  const first = f.addJoin('A <B> & "C"')
  await f.tick()
  f.addJoin('<script>')
  await f.tick()
  for (const call of f.announcements()) {
    assert.equal(call.parse_mode, 'HTML')
    assert.ok(call.text.includes(`<a href="tg://user?id=${first.uid}">A &lt;B&gt; &amp; &quot;C&quot;</a>`))
    assert.doesNotMatch(call.text, /<script>/)
  }
  assert.match(f.announcements().at(-1).text, /&lt;script&gt;/)
})

test('a deleted summary is recreated once with its accumulated names', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.tick()
  f.messages.clear()
  f.addJoin('Second')
  await f.tick()
  assert.deepEqual(
    f.announcements().map(({ method }) => method),
    ['sendMessage', 'editMessageText', 'sendMessage'],
  )
  assert.match(f.announcements().at(-1).text, /First.*Second/)
  assert.equal(f.messages.size, 1)
  assert.equal(f.pending().length, 0)
})

test('a temporary edit failure retries without sending a duplicate or losing names', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.tick()
  f.addJoin('Second', { age: 3600 })
  f.failures.set('editMessageText', ['Too Many Requests: retry after 30'])
  await f.tick()
  assert.equal(f.pending().length, 1)
  assert.equal(f.state().locked_until, 0)
  assert.equal(JSON.parse(f.state().members).length, 1)
  await f.tick()
  assert.deepEqual(
    f.announcements().map(({ method }) => method),
    ['sendMessage', 'editMessageText', 'editMessageText'],
  )
  assert.match(f.announcements().at(-1).text, /First.*Second/)
  assert.equal(f.pending().length, 0)
  assert.equal(f.messages.size, 1)
})

test('an unsuccessful send leaves the joins pending for the next run', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  f.failures.set('sendMessage', ['Internal Server Error'])
  await f.tick()
  assert.equal(f.pending().length, 1)
  assert.equal(f.state().message_id, null)
  await f.tick()
  assert.equal(f.pending().length, 0)
  assert.equal(f.messages.size, 1)
})

test('an already-applied edit is treated as successful', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.tick()
  f.addJoin('Second')
  f.failures.set('editMessageText', ['Bad Request: message is not modified'])
  await f.tick()
  assert.equal(f.pending().length, 0)
  assert.equal(f.announcements().filter(({ method }) => method === 'sendMessage').length, 1)
  assert.equal(JSON.parse(f.state().members).length, 2)
})

test('overlapping scheduled runs cannot create two summaries', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  f.hooks.set('sendMessage', () => f.tick())
  await f.tick()
  assert.equal(f.announcements().length, 1)
  assert.equal(f.pending().length, 0)
  assert.equal(f.state().locked_until, 0)
})

test('a crashed run lease expires so pending announcements can resume', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.receive({ text: 'Hello' })
  f.sqlite.prepare('UPDATE join_cleanup_announcement SET locked_until = ?').run(Date.now() / 1000 + 300)
  await f.tick()
  assert.equal(f.announcements().length, 0)
  f.sqlite.exec('UPDATE join_cleanup_announcement SET locked_until = 1')
  await f.tick()
  assert.equal(f.announcements().length, 1)
})

test('activity arriving during an edit is preserved for the next cleanup', async (t) => {
  const f = fixture(t)
  f.addJoin('First')
  await f.tick()
  f.addJoin('Second')
  f.hooks.set('editMessageText', () => f.receive({ text: 'Hello during the edit' }))
  await f.tick()
  assert.ok(f.state().last_activity_message_id > f.state().message_id)
  f.addJoin('Third')
  await f.tick()
  assert.equal(f.announcements().at(-1).method, 'sendMessage')
  assert.doesNotMatch(f.announcements().at(-1).text, /First|Second/)
  assert.match(f.announcements().at(-1).text, /Third/)
})

test('a long quiet period stays within one message and counts older names', async (t) => {
  const f = fixture(t)
  for (let batch = 0; batch < 3; batch++) {
    for (let index = 0; index < 40; index++) f.addJoin(`Name ${batch * 40 + index} ${'魚'.repeat(64)}`)
    await f.tick()
    assert.ok(f.announcements().at(-1).text.length <= 4096)
    const state = f.state()
    assert.equal(JSON.parse(state.members).length + state.omitted_count, (batch + 1) * 40)
  }
  assert.equal(f.messages.size, 1)
  assert.match(f.announcements().at(-1).text, /Name 119/)
  assert.match(f.announcements().at(-1).text, /另有 \d+ 人/)
  assert.doesNotMatch(f.announcements().at(-1).text, /Name 0 /)
})

test('verified and still-pending users retain the existing cleanup rules', async (t) => {
  const f = fixture(t)
  f.addJoin('Verified', { status: { status: 'member' } })
  f.addJoin('Waiting', { status: { status: 'restricted', is_member: true, can_send_messages: false } })
  f.addJoin('Expired', { age: 1000, status: { status: 'restricted', is_member: true, can_send_messages: false } })
  f.addJoin('Too soon', { age: 100 })
  await f.tick()
  assert.equal(f.announcements().length, 0)
  assert.deepEqual(
    f.pending().map(({ display_name }) => display_name),
    ['Waiting', 'Too soon'],
  )
  const results = f.sqlite.prepare('SELECT display_name, result FROM pending_join_cleanup WHERE processed = true ORDER BY user_id').all()
  assert.deepEqual(
    results.map(({ display_name, result }) => [display_name, result]),
    [
      ['Verified', 'kept'],
      ['Expired', 'expired'],
    ],
  )
})

test('the additive migration is repeatable and preserves existing data', async (t) => {
  const f = fixture(t)
  f.addJoin('Pending')
  f.sqlite.exec("INSERT INTO silence_poll (poll_id) VALUES ('existing')")
  f.sqlite.exec('DROP TABLE join_cleanup_announcement')
  const migration = readFileSync(resolve(__dirname, '../schema/join_cleanup_announcement.sql'), 'utf8')
  f.sqlite.exec(migration)
  await f.receive({ text: 'Hello' })
  f.sqlite.exec(migration)
  assert.equal(f.pending().length, 1)
  assert.equal(f.sqlite.prepare('SELECT poll_id FROM silence_poll').get().poll_id, 'existing')
  assert.ok(f.state().last_activity_message_id > 0)
})
