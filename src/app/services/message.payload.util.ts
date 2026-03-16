import {
    Message,
    MessageAttachment,
    DirectMessagePayload,
} from './message.models';
import {
    buildMessageSearchTokens,
    sanitizeAttachments,
    sanitizeMentions,
} from './message.helpers';

export function requireNonEmpty(value: string, errorMessage: string): string {
    const cleaned = (value ?? '').trim();
    if (!cleaned) throw new Error(errorMessage);
    return cleaned;
}

export function ensureHasContent(
    text: string,
    attachments: MessageAttachment[],
): void {
    if (!text && !attachments.length) {
        throw new Error('Message requires text or attachments');
    }
}

export function createConversationId(
    firstUserId: string,
    secondUserId: string,
): string {
    return [firstUserId, secondUserId].sort().join('__');
}

export function buildMessagePayload(message: Message): Message {
    const text = (message.text ?? '').trim();
    const senderId = requireNonEmpty(message.senderId ?? '', 'Missing senderId');
    const mentions = sanitizeMentions(message.mentions, senderId);
    const attachments = sanitizeAttachments(message.attachments);
    ensureHasContent(text, attachments);
    return { ...message, text, senderId, mentions, attachments, searchTokens: buildMessageSearchTokens(text, attachments), timestamp: new Date(), read: false };
}

export function buildDirectMessagePayload(
    otherUserId: string,
    text: string,
    senderId: string,
    mentions: string[] = [],
    attachments: MessageAttachment[] = [],
): DirectMessagePayload {
    const cleanText = (text ?? '').trim();
    const cleanSenderId = requireNonEmpty(senderId, 'Missing senderId');
    const cleanAttachments = sanitizeAttachments(attachments);
    ensureHasContent(cleanText, cleanAttachments);
    return { text: cleanText, senderId: cleanSenderId, receiverId: otherUserId, conversationId: createConversationId(cleanSenderId, otherUserId), mentions: sanitizeMentions(mentions, cleanSenderId), attachments: cleanAttachments };
}
