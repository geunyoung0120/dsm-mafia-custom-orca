import { useNativeChatComposerSubmit } from './use-native-chat-composer-submit'
import { useNativeChatPtyComposerSend } from './use-native-chat-pty-composer-send'
import { useNativeChatStructuredComposerSend } from './use-native-chat-structured-composer-send'

type MessageSendArgs = Parameters<typeof useNativeChatPtyComposerSend>[0] &
  Parameters<typeof useNativeChatStructuredComposerSend>[0] &
  Omit<Parameters<typeof useNativeChatComposerSubmit>[0], 'sendPty' | 'sendStructured'>

export function useNativeChatComposerMessageSend(args: MessageSendArgs) {
  const sendStructured = useNativeChatStructuredComposerSend(args)
  const sendPty = useNativeChatPtyComposerSend(args)
  return { ...useNativeChatComposerSubmit({ ...args, sendPty, sendStructured }), sendStructured }
}
