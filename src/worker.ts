import Env = Cloudflare.Env
import { isSpamFn, unixEpoch, unixToTimezone, template } from './helpers'
import {
  banChatMember,
  deleteMessage,
  editMessageText,
  getChatMember,
  promoteChatMember,
  restrictChatMember,
  setChatAdministratorCustomTitle,
  sendMessage,
  sendPoll,
  stopPoll,
  getUserProfilePhotos,
  sendPhoto,
} from './tg-bot-api'
import { Update } from 'node-telegram-bot-api'

export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties<unknown>>, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env))
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request<unknown, IncomingRequestCfProperties<unknown>>, env: Env): Promise<Response> {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_HOOK_SECRET) {
    console.log('UNAUTHORIZED request')
    return new Response('UNAUTHORIZED')
  }

  const token = env.TG_BOT_TOKEN
  const isSpam: (input: string | undefined | null) => boolean = isSpamFn(env.TG_SPAM_RE)
  const body = await request.text()
  console.log('Update body:', body)
  
  let update: Update
  try {
    update = JSON.parse(body)
  } catch (e) {
    console.error('Failed to parse update body:', e)
    return new Response('BAD_REQUEST', { status: 400 })
  }

  if (update.message) {
    const message = update.message
    const { chat, from, message_id: mid, new_chat_members, left_chat_member, text } = message
    const cid = chat?.id
    const cUsername = chat?.username
    const entities = message?.entities ?? []

    console.log(`Processing message ${mid} in chat ${cid} (${cUsername})`)

    if (cUsername && env.TG_ALLOWED_CHAT_USERNAMES.split(',').find((it) => it === cUsername) === undefined) {
      console.log('Unsupported chat:', cUsername)
      return new Response('OK')
    }

    if (new_chat_members) {
      for (let member of new_chat_members) {
        if (isSpam(`${member.first_name ?? ''} ${member.last_name ?? ''}`)) {
          console.log(`Banning spam user ${member.id}`)
          await banChatMember({ token, cid, uid: member.id, mid })
        }
      }
    }

    if (from && (isSpam(`${from.first_name ?? ''} ${from.last_name ?? ''}`) || isSpam(text))) {
      console.log(`Banning spam sender ${from.id}`)
      await banChatMember({ token, cid, uid: from.id, mid })
      await deleteMessage({ token, cid, mid })
      return new Response('OK')
    }

    if (left_chat_member && from?.username === env.TG_BOT_USERNAME && isSpam(`${left_chat_member.first_name ?? ''} ${left_chat_member.last_name ?? ''}`)) {
      console.log(`Deleting leave message for spam user`)
      await deleteMessage({ token, cid, mid })
    }

    if (from && entities.length > 0) {
      for (let entity of entities) {
        if (entity.type === 'bot_command' && text?.startsWith('/customtitle')) {
          const reply_to_message = message?.reply_to_message
          const rid = reply_to_message?.from?.id
          const isBot = reply_to_message?.from?.is_bot
          const customTitle = text.replace(/\/customtitle(?:@\w+)?\s*/, '').trim()
          if (rid && !isBot && customTitle) {
            console.log(`Handling customtitle for ${rid}`)
            const member = (await getChatMember({ token, cid, uid: from.id })) as any
            if (member.status === 'creator' || member.status === 'administrator') {
              const isFakeAdmin = member.status === 'administrator' && !member.can_change_info && !member.can_delete_messages && !member.can_restrict_members && member.can_invite_users && !member.can_pin_messages && !member.can_post_stories && !member.can_edit_stories && !member.can_delete_stories && !member.can_manage_video_chats && !member.is_anonymous && !member.can_promote_members && !!member.custom_title
              if (!isFakeAdmin) {
                const success = await promoteChatMember({ token, cid, uid: rid, permissions: { can_invite_users: true } })
                if (success) await setChatAdministratorCustomTitle({ token, cid, uid: rid, customTitle })
              }
            } else {
              await sendMessage({ token, cid, text: env.TG_ADMIN_ONLY_COMMAND_TEXT, reply_to_message_id: mid })
            }
          }
        } else if (entity.type === 'bot_command' && text?.startsWith(env.TG_SILENCE_CONSENSUS_COMMAND)) {
          const uid = from.id
          const username = from.username ?? `${from.first_name ?? ''} ${from.last_name ?? ''}`
          const reply_to_message = message?.reply_to_message
          const targetMessage = reply_to_message?.text ?? ''
          const rid = reply_to_message?.from?.id
          const isBot = reply_to_message?.from?.is_bot
          const rUsername = reply_to_message?.from?.username
          const rFullName = `${reply_to_message?.from?.first_name ?? ''} ${reply_to_message?.from?.last_name ?? ''}`
          const rmid = reply_to_message?.message_id
          const targetUsername = rUsername ?? rFullName

          if (!isBot && rid && rmid) {
            console.log(`Creating silence poll for ${targetUsername}`)
            const pollResp = await sendPoll({
              token, cid, mid: rmid,
              question: template(env.TG_SILENCE_CONSENSUS_POLL_QUESTION_TEMPLATE, {
                datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
                initUsername: username.replace('_', '\\_'),
                targetUsername: targetUsername.replace('_', '\\_'),
                pollDuration: (+env.TG_SILENCE_CONSENSUS_POLL_DURATION / 3600).toFixed(0),
                minCount: +env.TG_SILENCE_CONSENSUS_MIN_COUNT,
                positiveRatio: (+env.TG_SILENCE_CONSENSUS_POSITIVE_RATIO * 100).toFixed(0),
                restrictDuration: (+env.TG_SILENCE_CONSENSUS_RESTRICT_DURATION / 3600).toFixed(0),
              }),
              options: env.TG_SILENCE_CONSENSUS_POLL_OPTIONS.split(','),
            })
            if (!pollResp.ok) {
              console.error('Failed to send poll:', pollResp.description)
              await sendMessage({ token, cid, text: pollResp.description.includes('message to be replied not found') ? env.TG_SILENCE_CONSENSUS_POLL_TARGET_MESSAGE_IS_REMOVED : env.TG_SILENCE_CONSENSUS_POLL_UNKNOWN_ERROR })
              return new Response('OK')
            }
            const statusResp = await sendMessage({ token, cid, text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, { datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE), targetUsername, totalCount: 0, positiveRatio: 0, targetUserStatus: env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_TEMPLATE, negativeVoters: '無' }) })
            const pollId = pollResp.result.poll?.id
            const pollMessageId = pollResp.result.message_id
            const statusMessageId = statusResp.message_id
            if (pollId && statusMessageId) {
              await env.DB.prepare(`INSERT INTO silence_poll VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, false, ?, false, null, null, unixepoch(), ?, false)`).bind(pollId, cid, uid, username, rid, targetUsername, targetMessage, statusMessageId, pollMessageId).run()
            }
          }
        }
      }
    }
  }

  const updateAny = update as any
  if (updateAny.message_reaction) {
    console.log('Processing message_reaction')
    const { chat, user, message_id: mid } = updateAny.message_reaction
    const uid = user?.id
    if (uid && chat.username && env.TG_ALLOWED_CHAT_USERNAMES.split(',').includes(chat.username)) {
      const member = await getChatMember({ token, cid: chat.id, uid })
      if (member && (member.status === 'left' || member.status === 'kicked')) {
        const success = await banChatMember({ token, cid: chat.id, uid, mid })
        if (success && user) {
          const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
          const caption = `嗚呀，又有新款靚女登場🤖\n🚫BANNED ${fullName}`
          const photos = await getUserProfilePhotos({ token, uid })
          if (photos?.total_count > 0 && photos.photos[0]) {
            const photoArray = photos.photos[0]
            await sendPhoto({ token, cid: chat.id, photo: photoArray[photoArray.length - 1].file_id, caption })
          } else {
            await sendMessage({ token, cid: chat.id, text: caption })
          }
        }
      }
    }
  }

  if (update.poll) {
    console.log('Processing poll update:', update.poll.id)
    const pollId = update.poll.id
    const positiveCount = update.poll.options[0]?.voter_count ?? 0
    const totalCount = update.poll.total_voter_count
    const { results } = await env.DB.prepare(`UPDATE silence_poll SET total_vote = ?, positive_vote = ? WHERE poll_id = ? RETURNING *`).bind(totalCount, positiveCount, pollId).all()
    if (results[0]) await refreshStatusMessage(token, env, results[0])
    else console.log('No silence_poll record found for poll_id:', pollId)
  }

  if (update.poll_answer) {
    console.log('Processing poll_answer:', update.poll_answer.poll_id)
    const { poll_id: pollId, user, option_ids: optionIds } = update.poll_answer
    await env.DB.prepare(`INSERT INTO silence_poll_vote (poll_id, user_id, full_name, username, option_idx, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch()) ON CONFLICT (poll_id, user_id) DO UPDATE SET full_name = excluded.full_name, username = excluded.username, option_idx = excluded.option_idx, updated_at = excluded.updated_at`).bind(pollId, user.id, `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(), user.username ?? '', optionIds[0] ?? -1).run()
    const { results } = await env.DB.prepare('SELECT * FROM silence_poll WHERE poll_id = ?').bind(pollId).all()
    if (results[0]) await refreshStatusMessage(token, env, results[0])
    else console.log('No silence_poll record found for poll_id:', pollId)
  }

  return new Response('OK')
}

async function refreshStatusMessage(token: string, env: Env, record: any) {
  try {
    const pollId = record.poll_id as string
    const cid = record.chat_id as number
    const rid = record.target_user_id as number

    console.log(`Refreshing status for poll ${pollId}`)

    const { results: allVotes } = (await env.DB.prepare(`SELECT option_idx, full_name, username FROM silence_poll_vote WHERE poll_id = ?`).bind(pollId).all()) as { results: any[] }

    const positiveCount = allVotes.filter((v) => v.option_idx === 0).length
    const negativeVotersResults = allVotes.filter((v) => v.option_idx === 1)
    const negativeCount = negativeVotersResults.length
    const totalVoterCount = allVotes.length

    const negativeVoters = negativeVotersResults.map((it: any) => it.username ? `${it.full_name} (@${it.username})` : it.full_name).join(', ') || '無'
    const decisionVoteCount = positiveCount + negativeCount
    const positiveRatio = decisionVoteCount === 0 ? 0 : positiveCount / decisionVoteCount
    const shouldSilence = decisionVoteCount >= +env.TG_SILENCE_CONSENSUS_MIN_COUNT && positiveRatio >= +env.TG_SILENCE_CONSENSUS_POSITIVE_RATIO
    const untilDate = (record.created_at as number) + +env.TG_SILENCE_CONSENSUS_RESTRICT_DURATION

    if (unixEpoch() - record.created_at >= +env.TG_SILENCE_CONSENSUS_POLL_DURATION && !record.is_closed && record.poll_message_id) {
      console.log('Poll expired, closing.')
      await stopPoll({ token, cid, mid: record.poll_message_id })
      await env.DB.prepare('UPDATE silence_poll SET is_closed = true WHERE poll_id = ?').bind(pollId).run()
    }

    let userStatus = !shouldSilence ? (record.silence_status ? env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_WITH_GRACE_TEMPLATE : env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_TEMPLATE) : template(env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_RESTRICTED_TEMPLATE, { untilDate: unixToTimezone(untilDate, env.TG_BOT_TIMEZONE) })

    console.log(`Checking chat member ${rid} status`)
    const member = (await getChatMember({ token, cid, uid: rid })) as any
    if (shouldSilence && (member.status === 'creator' || member.status === 'administrator')) {
      const isFakeAdmin = member.status === 'administrator' && !member.can_change_info && !member.can_delete_messages && !member.can_restrict_members && member.can_invite_users && !member.can_pin_messages && !member.can_post_stories && !member.can_edit_stories && !member.can_delete_stories && !member.can_manage_video_chats && !member.is_anonymous && !member.can_promote_members && !!member.custom_title
      if (!isFakeAdmin) {
        userStatus = template(env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_CANNOT_SILENCE_ADMIN_TEMPLATE, { targetUsername: record.target_username })
      } else if (!record.silence_status) {
        console.log('Silencing fake admin')
        await promoteChatMember({ token, cid, uid: rid, permissions: { can_invite_users: false } })
        await env.DB.prepare(`UPDATE silence_poll SET is_admin = ?, admin_permissions = ?, admin_custom_title = ? WHERE poll_id = ?`).bind(true, JSON.stringify({ can_invite_users: true }), member.custom_title, pollId).run()
      }
    }

    console.log('Editing status message')
    const editResult = await editMessageText({
      token, cid, mid: record.status_message_id,
      text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
        datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
        targetUsername: record.target_username,
        totalCount: decisionVoteCount,
        positiveRatio: (positiveRatio * 100).toFixed(0),
        negativeVoters,
        targetUserStatus: userStatus,
      }),
    })

    if (!editResult.ok && !editResult.description.includes('message is not modified')) {
      console.error('Failed to edit message:', editResult.description)
    }

    if (shouldSilence && !record.silence_status && member.status !== 'creator' && (member.status !== 'administrator' || (member.status === 'administrator' && !!record.is_admin))) {
      console.log(`Applying restriction to ${rid}`)
      if (await restrictChatMember({ token, cid, uid: rid, untilDate })) {
        await env.DB.prepare(`UPDATE silence_poll SET silence_status = true WHERE poll_id = ?`).bind(pollId).run()
      }
    } else if (!shouldSilence && record.silence_status) {
      console.log(`Removing restriction from ${rid}`)
      if (await restrictChatMember({ token, cid, uid: rid, untilDate: unixEpoch() + 60, permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true } })) {
        if (record.is_admin) {
          console.log('Restoring admin rights')
          const success = await promoteChatMember({ token, cid, uid: rid, permissions: JSON.parse(record.admin_permissions) })
          if (success) await setChatAdministratorCustomTitle({ token, cid, uid: rid, customTitle: record.admin_custom_title })
        }
        await env.DB.prepare(`UPDATE silence_poll SET silence_status = false WHERE poll_id = ?`).bind(pollId).run()
      }
    }
  } catch (err) {
    console.error('Error in refreshStatusMessage:', err)
  }
}

async function handleScheduled(env: Env) {
  try {
    const { results } = await env.DB.prepare(`SELECT * FROM silence_poll WHERE is_closed = false AND created_at < ?`).bind(unixEpoch() - +env.TG_SILENCE_CONSENSUS_POLL_DURATION).all()
    for (const record of results) {
      if (record.poll_message_id) await stopPoll({ token: env.TG_BOT_TOKEN, cid: record.chat_id as number, mid: record.poll_message_id as number })
      await env.DB.prepare(`UPDATE silence_poll SET is_closed = true WHERE poll_id = ?`).bind(record.poll_id).run()
    }
  } catch (err) {
    console.error('Error in handleScheduled:', err)
  }
}
