import { Injectable } from '@angular/core';
import { where, Timestamp, orderBy, limit, startAfter } from 'firebase/firestore';
import { Observable, catchError, map, of, throwError } from 'rxjs';
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
        const text = (message.text ?? '').trim();
        const senderId = (message.senderId ?? '').trim();
        const mentions = this.sanitizeMentions(message.mentions, senderId);

        if (!text && !this.sanitizeAttachments(message.attachments).length) {
            throw new Error('Message content is empty');
        }

        if (!senderId) {
            throw new Error('Missing senderId');
        }

        return this.firestoreService.addDocument(this.messagesCollection, {
            ...message,
            text,
            senderId,
            mentions,
            attachments: this.sanitizeAttachments(message.attachments),
            timestamp: new Date(),
            read: false,
        });
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
            .pipe(catchError((error) => this.logReadError('CHANNEL_LIVE', error)));
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
            .pipe(catchError((error) => this.logReadError('CHANNEL_OLDER', error)));
    }

    getDirectMessages(otherUserId: string): Observable<Message[]> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) {
            return of([]);
        }

        const conversationId = this.createConversationId(
            currentUser.uid,
            otherUserId,
        );

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
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) {
            return of([]);
        }

        const conversationId = this.createConversationId(
            currentUser.uid,
            otherUserId,
        );

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
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) {
            return of([]);
        }

        const conversationId = this.createConversationId(
            currentUser.uid,
            otherUserId,
        );

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
        const cleanText = (text ?? '').trim();
        const cleanSenderId = (senderId ?? '').trim();
        const cleanMentions = this.sanitizeMentions(mentions, cleanSenderId);

        if (!cleanSenderId) {
            throw new Error('Missing senderId');
        }

        if (!cleanText && !this.sanitizeAttachments(attachments).length) {
            throw new Error('Message content is empty');
        }

        const conversationId = this.createConversationId(
            cleanSenderId,
            otherUserId,
        );

        return this.firestoreService.addDocument(this.messagesCollection, {
            text: cleanText,
            senderId: cleanSenderId,
            receiverId: otherUserId,
            conversationId,
            mentions: cleanMentions,
            attachments: this.sanitizeAttachments(attachments),
            timestamp: new Date(),
            read: false,
        });
    }

    sendDirectMessageWithId(
        messageId: string,
        otherUserId: string,
        text: string,
        senderId: string,
        mentions: string[] = [],
        attachments: MessageAttachment[] = [],
    ): Observable<string> {
        const cleanText = (text ?? '').trim();
        const cleanSenderId = (senderId ?? '').trim();

        if (!cleanSenderId) {
            throw new Error('Missing senderId');
        }

        if (!cleanText && !attachments.length) {
            throw new Error('Message requires text or attachments');
        }

        const conversationId = this.createConversationId(
            cleanSenderId,
            otherUserId,
        );

        return this.sendMessageWithId(messageId, {
            text: cleanText,
            senderId: cleanSenderId,
            receiverId: otherUserId,
            conversationId,
            mentions,
            attachments,
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
        if (!normalized) {
            return of([]);
        }

        return this.firestoreService.queryDocuments<Message>(
            this.messagesCollection,
            [
                where('searchTokens', 'array-contains', normalized),
                orderBy('timestamp', 'desc'),
                limit(20),
            ],
        );
    }

    getChannelThreadMessages(parentMessageId: string): Observable<ThreadMessage[]> {
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
        const cleanParentMessageId = parentMessageId.trim();
        const cleanText = text.trim();
        const cleanSenderId = senderId.trim();

        if (!cleanParentMessageId) {
            throw new Error('Missing parentMessageId');
        }

        if (!cleanText) {
            throw new Error('Thread message text is empty');
        }

        if (!cleanSenderId) {
            throw new Error('Missing senderId');
        }

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
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        return new Observable((observer) => {
            this.firestoreService
                .getDocument<Message>(this.messagesCollection, messageId)
                .subscribe({
                    next: (message) => {
                        if (!message) {
                            observer.error(new Error('Message not found'));
                            return;
                        }

                        const existing = (message.reactions ?? []).map(
                            (reaction) => ({
                                ...reaction,
                                userIds: [...reaction.userIds],
                            }),
                        );
                        const reactionIndex = existing.findIndex(
                            (reaction) => reaction.emoji === emoji,
                        );

                        if (reactionIndex >= 0) {
                            const target = existing[reactionIndex];
                            const hasReacted = target.userIds.includes(
                                currentUser.uid,
                            );

                            if (hasReacted) {
                                target.userIds = target.userIds.filter(
                                    (userId) => userId !== currentUser.uid,
                                );
                                if (!target.userIds.length) {
                                    existing.splice(reactionIndex, 1);
                                }
                            } else {
                                target.userIds.push(currentUser.uid);
                            }
                        } else {
                            existing.push({
                                emoji,
                                userIds: [currentUser.uid],
                            });
                        }

                        this.firestoreService
                            .updateDocument(
                                this.messagesCollection,
                                messageId,
                                {
                                    reactions: existing,
                                },
                            )
                            .subscribe({
                                next: () => {
                                    observer.next();
                                    observer.complete();
                                },
                                error: (error) => observer.error(error),
                            });
                    },
                    error: (error) => observer.error(error),
                });
        });
    }

    private createConversationId(
        firstUserId: string,
        secondUserId: string,
    ): string {
        return [firstUserId, secondUserId].sort().join('__');
    }

    private toTimestampMillis(value: Timestamp | Date): number {
        if (value instanceof Date) {
            return value.getTime();
        }

        if ('toMillis' in value && typeof value.toMillis === 'function') {
            return value.toMillis();
        }

        if ('toDate' in value && typeof value.toDate === 'function') {
            return value.toDate().getTime();
        }

        return 0;
    }

    private sanitizeMentions(mentions: string[] | undefined, senderId: string): string[] {
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
        if (!attachments?.length) {
            return [];
        }

        return attachments
            .filter((item) => !!item?.name && !!item?.url && !!item?.path)
            .map((item) => ({
                name: item.name,
                path: item.path,
                url: item.url,
                size: Number(item.size ?? 0),
                contentType: item.contentType ?? '',
                isImage: !!item.isImage,
            }));
    }

    private buildMessagePayload(message: Message): Message {
        const text = (message.text ?? '').trim();
        const senderId = (message.senderId ?? '').trim();
        const mentions = this.sanitizeMentions(message.mentions, senderId);
        const attachments = this.sanitizeAttachments(message.attachments);

        if (!senderId) {
            throw new Error('Missing senderId');
        }

        if (!text && !attachments.length) {
            throw new Error('Message requires text or attachments');
        }

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

    private buildMessageSearchTokens(
        text: string,
        attachments: MessageAttachment[],
    ): string[] {
        const attachmentNames = attachments.map((item) => item.name ?? '');
        return buildSearchTokens([text, ...attachmentNames]);
    }

    private mergeAndSortMessages(messages: Message[]): Message[] {
        const deduplicated = new Map<string, Message>();

        messages.forEach((message, index) => {
            const key =
                message.id ?? `${message.senderId}-${message.text}-${index}`;
            deduplicated.set(key, message);
        });

        return Array.from(deduplicated.values()).sort(
            (left, right) =>
                this.toTimestampMillis(left.timestamp) -
                this.toTimestampMillis(right.timestamp),
        );
    }
}
