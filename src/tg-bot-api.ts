import { Message, ChatMember, ChatAdministratorRights, ChatPermissions } from 'node-telegram-bot-api'

const endpoint = 'https://api.telegram.org'

async function botRequest<T>(token: string, tgMethod: string, payload: object): Promise<{ ok: boolean; result: T; description: string }> {
  return fetch(
    new Request(`${endpoint}/bot${token}/${tgMethod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  )
    .then((it) => it.json<{ ok: boolean; result: T; description: string }>())
    .then((it) => {
      console.log(tgMethod, it)
      return it
    })
}

async function deleteMessage({ token, cid, mid }: { token: string; cid: number; mid: number }): Promise<boolean> {
  return botRequest(token, 'deleteMessage', {
    chat_id: cid,
    message_id: mid,
  }).then((it) => it.ok)
}

async function banChatMember({ token, cid, uid, mid }: { token: string; cid: number; uid: number; mid: number }): Promise<boolean> {
  return await botRequest(token, 'banChatMember', {
    chat_id: cid,
    user_id: uid,
    revoke_messages: true,
  }).then((it) => it.ok)
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
}): Promise<{ ok: boolean; result: Message; description: string }> {
  return botRequest<Message>(token, 'sendPoll', {
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

async function getChatMember({ token, cid, uid }: { token: string; cid: number; uid: number }): Promise<ChatMember> {
  return botRequest<ChatMember>(token, 'getChatMember', {
    chat_id: cid,
    user_id: uid,
  }).then((it) => it.result)
}

async function promoteChatMember({
  token,
  cid,
  uid,
  permissions,
}: {
  token: string
  cid: number
  uid: number
  permissions: Partial<ChatAdministratorRights>
}): Promise<boolean> {
  return botRequest(token, 'promoteChatMember', {
    chat_id: cid,
    user_id: uid,
    ...permissions,
  }).then((it) => it.ok)
}

async function setChatAdministratorCustomTitle({
  token,
  cid,
  uid,
  customTitle,
}: {
  token: string
  cid: number
  uid: number
  customTitle: string
}): Promise<boolean> {
  return botRequest(token, 'setChatAdministratorCustomTitle', {
    chat_id: cid,
    user_id: uid,
    custom_title: customTitle,
  }).then((it) => it.ok)
}

async function restrictChatMember({
  token,
  cid,
  uid,
  untilDate,
  permissions,
}: {
  token: string
  cid: number | string
  uid: number
  untilDate: number
  permissions?: Partial<ChatPermissions>
}): Promise<boolean> {
  return botRequest(token, 'restrictChatMember', {
    chat_id: cid,
    user_id: uid,
    permissions:
      permissions ??
      JSON.stringify({
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
  }).then((it) => it.ok)
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
}): Promise<{ ok: boolean; result: Message; description: string }> {
  return botRequest<Message>(token, 'editMessageText', {
    chat_id: cid,
    message_id: mid,
    text: text,
  })
}

async function sendMessage({
  token,
  cid,
  text,
  reply_to_message_id,
}: {
  token: string
  cid: number
  text: string
  reply_to_message_id?: number
}): Promise<Message> {
  return botRequest<Message>(token, 'sendMessage', {
    chat_id: cid,
    text: text,
    reply_to_message_id,
  }).then((it) => it.result)
}

export {
  deleteMessage,
  banChatMember,
  sendPoll,
  editMessageText,
  sendMessage,
  restrictChatMember,
  getChatMember,
  promoteChatMember,
  setChatAdministratorCustomTitle,
}
