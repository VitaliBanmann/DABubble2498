import { Timestamp } from 'firebase/firestore';

/** Emoji reaction attached to a message. */
export interface MessageReaction extends Record<string, unknown> {
    emoji: string;
    userIds: string[];
}

/** File attachment metadata stored with a message. */
export interface MessageAttachment extends Record<string, unknown> {
    name: string;
    path: string;
    url: string;
    size: number;
    contentType: string;
    isImage: boolean;
}

/** Message entity used across channel and direct message contexts. */
export interface Message extends Record<string, unknown> {
    id?: string;
    text: string;
    senderId: string;
    receiverId?: string;
    channelId?: string;
    conversationId?: string;
    timestamp: Timestamp | Date;
    read?: boolean;
    edited?: boolean;
    editedAt?: Date;
    reactions?: MessageReaction[];
    mentions?: string[];
    attachments?: MessageAttachment[];
    searchTokens?: string[];
    threadReplyCount?: number;
}

/** Message entity used inside a thread. */
export interface ThreadMessage extends Record<string, unknown> {
    id?: string;
    text: string;
    senderId: string;
    timestamp: Timestamp | Date;
}

/** Payload required to send a direct message. */
export interface DirectMessagePayload {
    text: string;
    senderId: string;
    receiverId: string;
    conversationId: string;
    mentions: string[];
    attachments: MessageAttachment[];
}
