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
  getUserProfilePhotos,
  sendPhoto,
} from './tg-bot-api'
import { Update } from 'node-telegram-bot-api'

export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties<unknown>>, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<Env>

async function handleRequest(request: Request<unknown, IncomingRequestCfProperties<unknown>>, env: Env): Promise<Response> {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_HOOK_SECRET) {
    return new Response('UNAUTHORIZED')
  }

  // TG Bot token from environment secret
  const token = env.TG_BOT_TOKEN

  const isSpam: (input: string | undefined | null) => boolean = isSpamFn(env.TG_SPAM_RE)

  const update: Update = JSON.parse(await request.text())
  console.log('update', update)

  // process user message
  if (update.message) {
    const message = update.message
    const { chat, from, message_id: mid, new_chat_members, left_chat_member, text } = message
    const cid = chat?.id
    const cUsername = chat?.username
    const entities = message?.entities ?? []

    if (cUsername && env.TG_ALLOWED_CHAT_USERNAMES.split(',').find((it) => it === cUsername) === undefined) {
      // early return if this chat is not supported
      console.log('unsupported chat', cUsername)

      return new Response('OK')
    }

    if (new_chat_members) {
      // Scenario 1: if the username join the channel with spam keyword
      for (let member of new_chat_members) {
        const uid = member.id
        const fullName = `${member.first_name ?? ''} ${member.last_name ?? ''}`

        if (isSpam(fullName)) {
          await banChatMember({ token, cid, uid, mid })
        }
      }
    }

    if (from) {
      // Scenario 2: if the username switched their name with spam keyword and sent a message
      const uid = from.id
      const fullName = `${from.first_name ?? ''} ${from.last_name ?? ''}`

      if (isSpam(fullName) || isSpam(text)) {
        await banChatMember({ token, cid, uid, mid })
        await deleteMessage({ token, cid, mid })
        // early return if the user is classified as spam
        return new Response('OK')
      }
    }

    if (left_chat_member && from?.username === env.TG_BOT_USERNAME) {
      // Scenario 3: after banning a chat message, telegram will show "Bot has removed XXX" message
      // remove this message for more clean experience
      const firstName = left_chat_member.first_name ?? ''
      const lastName = left_chat_member.last_name ?? ''
      const fullName = `${firstName} ${lastName}`

      if (isSpam(fullName)) {
        await deleteMessage({ token, cid, mid })
      }
    }

    if (from && entities.length > 0) {
      // Scenario 4: Check if bot command consist of env.TG_SILENCE_CONSENSUS_COMMAND
      for (let entity of entities) {
        if (entity.type === 'bot_command' && text?.startsWith('/customtitle')) {
          const reply_to_message = message?.reply_to_message
          const rid = reply_to_message?.from?.id
          const isBot = reply_to_message?.from?.is_bot
          const customTitle = text.replace(/\/customtitle(?:@\w+)?\s*/, '').trim()

          if (rid && !isBot && customTitle) {
            const member = (await getChatMember({ token, cid, uid: from.id })) as any
            if (member.status === 'creator' || member.status === 'administrator') {
              const isFakeAdmin =
                member.status === 'administrator' &&
                !member.can_change_info &&
                !member.can_delete_messages &&
                !member.can_restrict_members &&
                member.can_invite_users &&
                !member.can_pin_messages &&
                !member.can_post_stories &&
                !member.can_edit_stories &&
                !member.can_delete_stories &&
                !member.can_manage_video_chats &&
                !member.is_anonymous &&
                !member.can_promote_members &&
                !!member.custom_title

              if (!isFakeAdmin) {
                const success = await promoteChatMember({
                  token,
                  cid,
                  uid: rid,
                  permissions: {
                    can_invite_users: true,
                  },
                })
                if (success) {
                  await setChatAdministratorCustomTitle({
                    token,
                    cid,
                    uid: rid,
                    customTitle,
                  })
                }
              }
            } else {
              await sendMessage({
                token,
                cid,
                text: env.TG_ADMIN_ONLY_COMMAND_TEXT,
                reply_to_message_id: mid,
              })
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

          // check if the request is not initiated by bot and have a reply message
          if (!isBot && rid && rmid) {
            const pollResp = await sendPoll({
              token,
              cid: cid,
              mid: rmid,
              question: template(env.TG_SILENCE_CONSENSUS_POLL_QUESTION_TEMPLATE, {
                datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
                initUsername: username.replace('_', '\\_'),
                targetUsername: targetUsername.replace('_', '\\_'),
                pollDuration: (+env.TG_SILENCE_CONSENSUS_POLL_DURATION / 60 / 60).toFixed(0),
                minCount: +env.TG_SILENCE_CONSENSUS_MIN_COUNT,
                positiveRatio: (+env.TG_SILENCE_CONSENSUS_POSITIVE_RATIO * 100).toFixed(0),
                restrictDuration: (+env.TG_SILENCE_CONSENSUS_RESTRICT_DURATION / 60 / 60).toFixed(0),
              }),
              options: env.TG_SILENCE_CONSENSUS_POLL_OPTIONS.split(','),
            })

            if (!pollResp.ok) {
              await sendMessage({
                token,
                cid,
                text: pollResp.description.includes('message to be replied not found')
                  ? env.TG_SILENCE_CONSENSUS_POLL_TARGET_MESSAGE_IS_REMOVED
                  : env.TG_SILENCE_CONSENSUS_POLL_UNKNOWN_ERROR,
              })
              console.log(pollResp)

              return new Response('OK')
            }

            const statusResp = await sendMessage({
              token,
              cid,
              text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
                datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
                targetUsername,
                totalCount: 0,
                positiveRatio: 0,
                targetUserStatus: env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_TEMPLATE,
              }),
            })

            const pollId = pollResp.result.poll?.id
            const statusMessageId = statusResp.message_id
            const silenceStatus = false

            if (pollId && statusMessageId) {
              // create poll record
              await env.DB.prepare(
                `
                  INSERT INTO silence_poll
                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, false, null, null, unixepoch())
              `,
              )
                .bind(pollId, cid, uid, username, rid, rUsername ?? rFullName, targetMessage, silenceStatus, statusMessageId)
                .all()
            }
          }
        }
      }
    }
  }

  // process reaction updates
  const updateAny = update as any
  if (updateAny.message_reaction) {
    const reaction = updateAny.message_reaction
    const { chat, user, message_id: mid } = reaction
    const cid = chat.id
    const cUsername = chat.username
    const uid = user?.id

    if (uid && cUsername && env.TG_ALLOWED_CHAT_USERNAMES.split(',').find((it) => it === cUsername) !== undefined) {
      const member = await getChatMember({ token, cid, uid })
      if (member && (member.status === 'left' || member.status === 'kicked')) {
        // Not a member!
        console.log(`Banning non-member ${uid} for reacting to message ${mid} in ${cid}`)
        const success = await banChatMember({ token, cid, uid, mid })

        if (success && user) {
          const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
          const caption = `嗚呀，又有新款靚女登場🤖\n🚫BANNED ${fullName}`

          const photos = await getUserProfilePhotos({ token, uid })
          if (photos && photos.total_count > 0 && photos.photos[0]) {
            // Send the photo with highest resolution (last one in the array)
            const photoArray = photos.photos[0]
            const fileId = photoArray[photoArray.length - 1].file_id
            await sendPhoto({ token, cid, photo: fileId, caption })
          } else {
            await sendMessage({ token, cid, text: caption })
          }
        }
      }
    }
  }

  // process poll updates
  if (update.poll) {
    const pollId = update.poll.id
    const { options, total_voter_count: totalCount } = update.poll
    const positiveCount = options[0]?.voter_count ?? 0
    const negativeCount = options[1]?.voter_count ?? 0

    // upsert options record
    const { results } = await env.DB.prepare(
      `
          UPDATE silence_poll
          SET total_vote = ?, positive_vote = ?
          WHERE poll_id = ? AND created_at >= ?
          RETURNING *;
      `,
    )
      .bind(totalCount, positiveCount, pollId, unixEpoch() - env.TG_SILENCE_CONSENSUS_POLL_DURATION)
      .all()

    const record = results[0]

    // if update return nothing, it is either expired 24 hours or not valid
    if (!record) {
      console.log(`record not found for ${pollId}`)
      return new Response('OK')
    }

    console.log(`record found and updated`, record)

    const cid = record.chat_id as number
    const rid = (record.target_user_id as number) ?? -1
    const decisionVoteCount = positiveCount + negativeCount
    const positiveRatio = decisionVoteCount === 0 ? 0 : positiveCount / decisionVoteCount
    const shouldSilence = totalCount >= +env.TG_SILENCE_CONSENSUS_MIN_COUNT && positiveRatio >= +env.TG_SILENCE_CONSENSUS_POSITIVE_RATIO
    const hasSilenceRecord = !!record.silence_status
    const targetUsername = record.target_username as string
    const createdAt = record.created_at as number
    const untilDate = createdAt + env.TG_SILENCE_CONSENSUS_RESTRICT_DURATION

    if (shouldSilence && !hasSilenceRecord) {
      console.log(`silence ${rid}: ${pollId}`)

      const member = (await getChatMember({ token, cid, uid: rid })) as any
      if (member.status === 'creator' || member.status === 'administrator') {
        const isFakeAdmin =
          member.status === 'administrator' &&
          !member.can_change_info &&
          !member.can_delete_messages &&
          !member.can_restrict_members &&
          member.can_invite_users &&
          !member.can_pin_messages &&
          !member.can_post_stories &&
          !member.can_edit_stories &&
          !member.can_delete_stories &&
          !member.can_manage_video_chats &&
          !member.is_anonymous &&
          !member.can_promote_members &&
          !!member.custom_title

        if (isFakeAdmin) {
          await promoteChatMember({ token, cid, uid: rid, permissions: { can_invite_users: false } })
          await env.DB.prepare(
            `
              UPDATE silence_poll
              SET is_admin = ?, admin_permissions = ?, admin_custom_title = ?
              WHERE poll_id = ?
            `,
          )
            .bind(true, JSON.stringify({ can_invite_users: true }), member.custom_title, pollId)
            .all()
        } else {
          // is real admin, cannot restrict
          await editMessageText({
            token,
            cid,
            mid: record.status_message_id as number,
            text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
              datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
              targetUsername,
              totalCount,
              positiveRatio: (positiveRatio * 100).toFixed(0),
              targetUserStatus: template(env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_CANNOT_SILENCE_ADMIN_TEMPLATE, {
                targetUsername,
              }),
            }),
          })
          return new Response('OK')
        }
      }

      const restrictResult = await restrictChatMember({ token, cid, uid: rid, untilDate })

      if (restrictResult) {
        await env.DB.prepare(
          `
              UPDATE silence_poll
              SET silence_status = ?
              WHERE poll_id = ?
            `,
        )
          .bind(true, pollId)
          .all()

        await editMessageText({
          token,
          cid,
          mid: record.status_message_id as number,
          text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
            datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
            targetUsername,
            totalCount,
            positiveRatio: (positiveRatio * 100).toFixed(0),
            targetUserStatus: template(env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_RESTRICTED_TEMPLATE, {
              untilDate: unixToTimezone(untilDate, env.TG_BOT_TIMEZONE),
            }),
          }),
        })
      }
    } else if (!shouldSilence && hasSilenceRecord) {
      console.log(`remove silence ${rid}: ${pollId}`)

      // the minimum `until_date` for telegram Bot API require current + 30 seconds
      const untilDate = unixEpoch() + 60

      const restrictResult = await restrictChatMember({
        token,
        cid,
        uid: rid,
        untilDate: untilDate,
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: true,
          can_invite_users: true,
          can_pin_messages: true,
          can_manage_topics: true,
        },
      })

      if (restrictResult) {
        if (record.is_admin) {
          const success = await promoteChatMember({
            token,
            cid,
            uid: rid,
            permissions: JSON.parse(record.admin_permissions as string),
          })
          if (success) {
            await setChatAdministratorCustomTitle({
              token,
              cid,
              uid: rid,
              customTitle: record.admin_custom_title as string,
            })
          }
        }

        await env.DB.prepare(
          `
              UPDATE silence_poll
              SET silence_status = ?
              WHERE poll_id = ?
            `,
        )
          .bind(false, pollId)
          .all()

        await editMessageText({
          token,
          cid,
          mid: record.status_message_id as number,
          text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
            datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
            targetUsername,
            totalCount,
            positiveRatio: (positiveRatio * 100).toFixed(0),
            targetUserStatus: env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_WITH_GRACE_TEMPLATE,
          }),
        })
      }
    } else {
      // update vote status
      await editMessageText({
        token,
        cid,
        mid: record.status_message_id as number,
        text: template(env.TG_SILENCE_CONSENSUS_POLL_STATUS_TEMPLATE, {
          datetime: unixToTimezone(unixEpoch(), env.TG_BOT_TIMEZONE),
          targetUsername,
          totalCount,
          positiveRatio: (positiveRatio * 100).toFixed(0),
          targetUserStatus: !hasSilenceRecord
            ? env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_FREE_TEMPLATE
            : template(env.TG_SILENCE_CONSENSUS_POLL_USER_STATUS_RESTRICTED_TEMPLATE, {
                untilDate: unixToTimezone(untilDate, env.TG_BOT_TIMEZONE),
              }),
        }),
      })
    }
  }

  return new Response('OK')
}
