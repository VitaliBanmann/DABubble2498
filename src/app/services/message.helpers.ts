import { buildSearchTokens } from './search-token.util';
import {
    Message,
    MessageAttachment,
    MessageReaction,
} from './message.models';

export function sanitizeMentions(
    mentions: string[] | undefined,
    senderId: string,
): string[] {
    if (!mentions?.length) return [];

    const unique = new Set(
        mentions
            .map((id) => (id ?? '').trim())
            .filter((id) => !!id && id !== senderId),
    );

    return Array.from(unique);
}

export function normalizeAttachment(
    item: MessageAttachment,
): MessageAttachment {
    return {
        name: item.name,
        path: item.path,
        url: item.url,
        size: Number(item.size ?? 0),
        contentType: item.contentType ?? '',
        isImage: !!item.isImage,
    };
}

export function sanitizeAttachments(
    attachments: MessageAttachment[] | undefined,
): MessageAttachment[] {
    if (!attachments?.length) return [];

    return attachments
        .filter((item) => !!item?.name && !!item?.url && !!item?.path)
        .map((item) => normalizeAttachment(item));
}

export function buildMessageSearchTokens(
    text: string,
    attachments: MessageAttachment[],
): string[] {
    const attachmentNames = attachments.map((item) => item.name ?? '');
    return buildSearchTokens([text, ...attachmentNames]);
}

export function computeUpdatedReactions(
    message: Message | null,
    emoji: string,
    userId: string,
): MessageReaction[] {
    if (!message) throw new Error('Message not found');

    const existing = (message.reactions ?? []).map((reaction) => ({
        ...reaction,
        userIds: [...reaction.userIds],
    }));

    const reactionIndex = existing.findIndex(
        (reaction) => reaction.emoji === emoji,
    );

    if (reactionIndex < 0) {
        return [...existing, { emoji, userIds: [userId] }];
    }

    return toggleUserReaction(existing, reactionIndex, userId);
}

function toggleUserReaction(
    reactions: MessageReaction[],
    reactionIndex: number,
    userId: string,
): MessageReaction[] {
    const next = [...reactions];
    const target = next[reactionIndex];

    if (!target.userIds.includes(userId)) {
        target.userIds.push(userId);
        return next;
    }

    target.userIds = target.userIds.filter((id) => id !== userId);
    if (!target.userIds.length) next.splice(reactionIndex, 1);
    return next;
}
