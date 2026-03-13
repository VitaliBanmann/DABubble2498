import { Injectable } from '@angular/core';
import {
    where,
    Timestamp,
    orderBy,
    limit,
    startAfter,
} from 'firebase/firestore';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { buildSearchTokens, normalizeSearchToken } from './search-token.util';

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

interface DirectMessagePayload {
    text: string;
    senderId: string;
    receiverId: string;
    conversationId: string;
    mentions: string[];
    attachments: MessageAttachment[];
}

@Injectable({
    providedIn: 'root',
})
export class MessageService {
    private messagesCollection = 'messages';
    private readonly defaultPageSize = 30;
    private logReadError(scope: string, error: unknown): Observable<never> {
        console.error(`[${scope}] Firestore read failed`, error);
        return throwError(() => error);
    }

    constructor(
        private firestoreService: FirestoreService,
        private authService: AuthService,
    ) {}

    sendMessage(message: Message): Observable<string> {
        return this.firestoreService.addDocument(
            this.messagesCollection,
            this.buildMessagePayload(message),
        );
    }

    createMessageId(): string {
        return this.firestoreService.createDocumentId(this.messagesCollection);
    }

    sendMessageWithId(messageId: string, message: Message): Observable<string> {
        const payload = this.buildMessagePayload(message);
        return this.firestoreService
            .setDocument(this.messagesCollection, messageId, payload)
            .pipe(map(() => messageId));
    }

    getChannelMessages(channelId: string): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'asc'),
            ])
            .pipe(catchError((error) => this.logReadError('CHANNEL', error)));
    }

    getPrivateMessages(otherUserId: string): Observable<Message[]> {
        return this.getDirectMessages(otherUserId);
    }

    streamLatestChannelMessages(
        channelId: string,
        pageSize = this.defaultPageSize,
    ): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'desc'),
                limit(pageSize),
            ])
            .pipe(
                catchError((error) => this.logReadError('CHANNEL_LIVE', error)),
            );
    }

    loadOlderChannelMessages(
        channelId: string,
        beforeTimestamp: Timestamp | Date,
        pageSize = this.defaultPageSize,
    ): Observable<Message[]> {
        return this.firestoreService
            .queryDocuments<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'desc'),
                startAfter(beforeTimestamp),
                limit(pageSize),
            ])
            .pipe(
                catchError((error) =>
                    this.logReadError('CHANNEL_OLDER', error),
                ),
            );
    }

    getDirectMessages(otherUserId: string): Observable<Message[]> {
        const conversationId = this.resolveConversationId(otherUserId);
        if (!conversationId) return of([]);

        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('conversationId', '==', conversationId),
                orderBy('timestamp', 'asc'),
            ])
            .pipe(catchError((error) => this.logReadError('DM', error)));
    }

    streamLatestDirectMessages(
        otherUserId: string,
        pageSize = this.defaultPageSize,
    ): Observable<Message[]> {
        const conversationId = this.resolveConversationId(otherUserId);
        if (!conversationId) return of([]);

        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('conversationId', '==', conversationId),
                orderBy('timestamp', 'desc'),
                limit(pageSize),
            ])
            .pipe(catchError((error) => this.logReadError('DM_LIVE', error)));
    }

    loadOlderDirectMessages(
        otherUserId: string,
        beforeTimestamp: Timestamp | Date,
        pageSize = this.defaultPageSize,
    ): Observable<Message[]> {
        const conversationId = this.resolveConversationId(otherUserId);
        if (!conversationId) return of([]);

        return this.firestoreService
            .queryDocuments<Message>(this.messagesCollection, [
                where('conversationId', '==', conversationId),
                orderBy('timestamp', 'desc'),
                startAfter(beforeTimestamp),
                limit(pageSize),
            ])
            .pipe(catchError((error) => this.logReadError('DM_OLDER', error)));
    }

    sendDirectMessage(
        otherUserId: string,
        text: string,
        senderId: string,
        mentions: string[] = [],
        attachments: MessageAttachment[] = [],
    ): Observable<string> {
        return this.sendMessage({
            ...this.buildDirectMessagePayload(
                otherUserId,
                text,
                senderId,
                mentions,
                attachments,
            ),
            timestamp: new Date(),
            read: false,
        });
    }

    searchChannelMessagesByToken(
        channelId: string,
        token: string,
    ): Observable<Message[]> {
        const normalized = normalizeSearchToken(token);
        if (!normalized || !channelId) return of([]);

        return this.firestoreService.queryDocuments<Message>(
            this.messagesCollection,
            [
                where('channelId', '==', channelId),
                where('searchTokens', 'array-contains', normalized),
                orderBy('timestamp', 'desc'),
                limit(10),
            ],
        );
    }

    sendDirectMessageWithId(
        messageId: string,
        otherUserId: string,
        text: string,
        senderId: string,
        mentions: string[] = [],
        attachments: MessageAttachment[] = [],
    ): Observable<string> {
        return this.sendMessageWithId(messageId, {
            ...this.buildDirectMessagePayload(
                otherUserId,
                text,
                senderId,
                mentions,
                attachments,
            ),
            timestamp: new Date(),
            read: false,
        });
    }

    updateMessage(
        messageId: string,
        updates: Partial<Message>,
    ): Observable<void> {
        return this.firestoreService.updateDocument(
            this.messagesCollection,
            messageId,
            { ...updates, editedAt: new Date(), edited: true },
        );
    }

    deleteMessage(messageId: string): Observable<void> {
        return this.firestoreService.deleteDocument(
            this.messagesCollection,
            messageId,
        );
    }

    markAsRead(messageId: string): Observable<void> {
        return this.firestoreService.updateDocument(
            this.messagesCollection,
            messageId,
            { read: true },
        );
    }

    getAllMessages(): Observable<Message[]> {
        return this.firestoreService.getDocuments<Message>(
            this.messagesCollection,
        );
    }

    searchMessagesByToken(token: string): Observable<Message[]> {
        const normalized = normalizeSearchToken(token);
        if (!normalized) return of([]);

        return this.firestoreService.queryDocuments<Message>(
            this.messagesCollection,
            [
                where('searchTokens', 'array-contains', normalized),
                orderBy('timestamp', 'desc'),
                limit(20),
            ],
        );
    }

    getChannelThreadMessages(
        parentMessageId: string,
    ): Observable<ThreadMessage[]> {
        if (!parentMessageId.trim()) {
            return of([]);
        }

        return this.firestoreService
            .queryDocumentsRealtime<ThreadMessage>(
                `messages/${parentMessageId}/threads`,
                [orderBy('timestamp', 'asc')],
            )
            .pipe(catchError((error) => this.logReadError('THREAD', error)));
    }

    sendChannelThreadMessage(
        parentMessageId: string,
        text: string,
        senderId: string,
    ): Observable<string> {
        const cleanParentMessageId = this.requireNonEmpty(
            parentMessageId,
            'Missing parentMessageId',
        );
        const cleanText = this.requireNonEmpty(
            text,
            'Thread message text is empty',
        );
        const cleanSenderId = this.requireNonEmpty(
            senderId,
            'Missing senderId',
        );

        return this.firestoreService.addDocument(
            `messages/${cleanParentMessageId}/threads`,
            {
                text: cleanText,
                senderId: cleanSenderId,
                timestamp: new Date(),
            },
        );
    }

    toggleReaction(messageId: string, emoji: string): Observable<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) throw new Error('User not authenticated');
        return this.firestoreService
            .getDocument<Message>(this.messagesCollection, messageId)
            .pipe(
                map((message) =>
                    this.computeUpdatedReactions(
                        message,
                        emoji,
                        currentUser.uid,
                    ),
                ),
                switchMap((reactions) =>
                    this.firestoreService.updateDocument(
                        this.messagesCollection,
                        messageId,
                        { reactions },
                    ),
                ),
            );
    }

    private createConversationId(
        firstUserId: string,
        secondUserId: string,
    ): string {
        return [firstUserId, secondUserId].sort().join('__');
    }

    private sanitizeMentions(
        mentions: string[] | undefined,
        senderId: string,
    ): string[] {
        if (!mentions?.length) {
            return [];
        }

        const unique = new Set(
            mentions
                .map((id) => (id ?? '').trim())
                .filter((id) => !!id && id !== senderId),
        );

        return Array.from(unique);
    }

    private sanitizeAttachments(
        attachments: MessageAttachment[] | undefined,
    ): MessageAttachment[] {
        if (!attachments?.length) return [];
        return attachments
            .filter((item) => !!item?.name && !!item?.url && !!item?.path)
            .map((item) => this.normalizeAttachment(item));
    }

    private buildMessagePayload(message: Message): Message {
        const text = (message.text ?? '').trim();
        const senderId = this.requireNonEmpty(
            message.senderId ?? '',
            'Missing senderId',
        );
        const mentions = this.sanitizeMentions(message.mentions, senderId);
        const attachments = this.sanitizeAttachments(message.attachments);
        this.ensureHasContent(text, attachments);
        return this.composeMessagePayload(
            message,
            text,
            senderId,
            mentions,
            attachments,
        );
    }

    private buildDirectMessagePayload(
        otherUserId: string,
        text: string,
        senderId: string,
        mentions: string[],
        attachments: MessageAttachment[],
    ): DirectMessagePayload {
        const cleanText = (text ?? '').trim();
        const cleanSenderId = this.requireNonEmpty(
            senderId,
            'Missing senderId',
        );
        const cleanAttachments = this.sanitizeAttachments(attachments);
        this.ensureHasContent(cleanText, cleanAttachments);
        const conversationId = this.createConversationId(
            cleanSenderId,
            otherUserId,
        );
        return this.composeDirectPayload(
            cleanText,
            cleanSenderId,
            otherUserId,
            conversationId,
            mentions,
            cleanAttachments,
        );
    }

    private composeMessagePayload(
        message: Message,
        text: string,
        senderId: string,
        mentions: string[],
        attachments: MessageAttachment[],
    ): Message {
        return {
            ...message,
            text,
            senderId,
            mentions,
            attachments,
            searchTokens: this.buildMessageSearchTokens(text, attachments),
            timestamp: new Date(),
            read: false,
        };
    }

    private composeDirectPayload(
        text: string,
        senderId: string,
        receiverId: string,
        conversationId: string,
        mentions: string[],
        attachments: MessageAttachment[],
    ): DirectMessagePayload {
        return {
            text,
            senderId,
            receiverId,
            conversationId,
            mentions: this.sanitizeMentions(mentions, senderId),
            attachments,
        };
    }

    private resolveConversationId(otherUserId: string): string | null {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) return null;
        return this.createConversationId(currentUser.uid, otherUserId);
    }

    private requireNonEmpty(value: string, errorMessage: string): string {
        const cleaned = (value ?? '').trim();
        if (!cleaned) throw new Error(errorMessage);
        return cleaned;
    }

    private ensureHasContent(
        text: string,
        attachments: MessageAttachment[],
    ): void {
        if (!text && !attachments.length) {
            throw new Error('Message requires text or attachments');
        }
    }

    private normalizeAttachment(item: MessageAttachment): MessageAttachment {
        return {
            name: item.name,
            path: item.path,
            url: item.url,
            size: Number(item.size ?? 0),
            contentType: item.contentType ?? '',
            isImage: !!item.isImage,
        };
    }

    private computeUpdatedReactions(
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
        if (reactionIndex < 0)
            return [...existing, { emoji, userIds: [userId] }];
        return this.toggleUserReaction(existing, reactionIndex, userId);
    }

    private toggleUserReaction(
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

    private buildMessageSearchTokens(
        text: string,
        attachments: MessageAttachment[],
    ): string[] {
        const attachmentNames = attachments.map((item) => item.name ?? '');
        return buildSearchTokens([text, ...attachmentNames]);
    }
}
