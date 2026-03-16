import { Timestamp } from '@angular/fire/firestore';

export interface MessageReaction extends Record<string, unknown> {
    emoji: string;
    userIds: string[];
}

export interface MessageAttachment extends Record<string, unknown> {
    name: string;
    path: string;
    url: string;
    size: number;
    contentType: string;
    isImage: boolean;
}

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
}

export interface ThreadMessage extends Record<string, unknown> {
    id?: string;
    text: string;
    senderId: string;
    timestamp: Timestamp | Date;
}

export interface DirectMessagePayload {
    text: string;
    senderId: string;
    receiverId: string;
    conversationId: string;
    mentions: string[];
    attachments: MessageAttachment[];
}
