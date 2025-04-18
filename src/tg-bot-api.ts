import { Message } from 'node-telegram-bot-api'

const endpoint = 'https://api.telegram.org'

async function botRequest<T>(token: string, tgMethod: string, payload: object): Promise<T> {
  return fetch(
    new Request(`${endpoint}/bot${token}/${tgMethod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  )
    .then((it) => it.json<{ ok: boolean; result: T }>())
    .then((it) => {
      console.log(tgMethod, it)
      return it.result
    })
}

async function deleteMessage({ token, cid, mid }: { token: string; cid: number; mid: number }): Promise<boolean> {
  return botRequest(token, 'deleteMessage', {
    chat_id: cid,
    message_id: mid,
  })
}

async function banChatMember({ token, cid, uid, mid }: { token: string; cid: number; uid: number; mid: number }): Promise<boolean> {
  return await botRequest(token, 'banChatMember', {
    chat_id: cid,
    user_id: uid,
    revoke_messages: true,
  })
}

async function sendPoll({
  token,
  cid,
  question,
  mid,
  options,
}: {
  token: string
  cid: number
  question: string
  mid: number
  options: string[]
}): Promise<Message> {
  return botRequest(token, 'sendPoll', {
    chat_id: cid,
    question: question,
    question_parse_mode: 'MarkdownV2',
    is_anonymous: true,
    reply_parameters: JSON.stringify({
      message_id: mid,
      quote_position: 0,
    }),
    options: JSON.stringify(options.map((it) => ({ text: it }))),
    protect_content: true,
  })
}

async function restrictChatMember({
  token,
  cid,
  uid,
  untilDate,
}: {
  token: string
  cid: number | string
  uid: number
  untilDate: number
}): Promise<boolean> {
  return botRequest(token, 'restrictChatMember', {
    chat_id: cid,
    user_id: uid,
    permissions: JSON.stringify({
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_topics: false,
    }),
    until_date: untilDate,
  })
}

async function editMessageText({
  token,
  cid,
  mid,
  text,
}: {
  token: string
  cid: number
  mid: number
  text: string
}): Promise<boolean | Message> {
  return botRequest(token, 'editMessageText', {
    chat_id: cid,
    message_id: mid,
    text: text,
  })
}

async function sendMessage({ token, cid, text }: { token: string; cid: number; text: string }): Promise<Message> {
  return botRequest(token, 'sendMessage', {
    chat_id: cid,
    text: text,
  })
}

export { deleteMessage, banChatMember, sendPoll, editMessageText, sendMessage, restrictChatMember }
