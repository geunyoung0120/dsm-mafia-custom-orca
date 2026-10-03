import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'

export async function dispatchNativeChatStructuredComposerText(
  transport: NativeChatStructuredComposerTransport,
  text: string,
  attachments: readonly NativeChatComposerImageAttachment[] = [],
  isCurrent: () => boolean = () => true
): Promise<{ accepted: boolean; error: string | null }> {
  if (!isCurrent()) {
    return { accepted: false, error: null }
  }
  const command = await transport.dispatchCommand(text)
  if (!isCurrent()) {
    return { accepted: false, error: null }
  }
  if (command.handled) {
    return { accepted: command.accepted, error: command.error }
  }
  return { accepted: transport.send(text, attachments), error: null }
}
