import { Injectable } from '@angular/core';
import {
    where,
    Timestamp,
    orderBy,
    limit,
    startAfter,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { normalizeSearchToken } from './search-token.util';
import {
    computeUpdatedReactions,
} from './message.helpers';
import {
    Message,
    MessageAttachment,
    ThreadMessage,
} from './message.models';
import {
    buildDirectMessagePayload,
    buildMessagePayload,
    createConversationId,
    requireNonEmpty,
} from './message.payload.util';

export type {
    Message,
    MessageAttachment,
    MessageReaction,
    ThreadMessage,
} from './message.models';

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
            buildMessagePayload(message),
        );
    }

    createMessageId(): string {
        return this.firestoreService.createDocumentId(this.messagesCollection);
    }

    sendMessageWithId(messageId: string, message: Message): Observable<string> {
        const payload = buildMessagePayload(message);
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
            ...buildDirectMessagePayload(
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
            ...buildDirectMessagePayload(
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
        const cleanParentMessageId = this.requireNonEmpty(parentMessageId, 'Missing parentMessageId');
        const cleanText = this.requireNonEmpty(text, 'Thread message text is empty');
        const cleanSenderId = this.requireNonEmpty(senderId, 'Missing senderId');
        return this.firestoreService.addDocument(`messages/${cleanParentMessageId}/threads`, { text: cleanText, senderId: cleanSenderId, timestamp: new Date() });
    }

    toggleReaction(messageId: string, emoji: string): Observable<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) throw new Error('User not authenticated');
        return this.firestoreService.getDocument<Message>(this.messagesCollection, messageId).pipe(
            map((message) => computeUpdatedReactions(message, emoji, currentUser.uid)),
            switchMap((reactions) => this.firestoreService.updateDocument(this.messagesCollection, messageId, { reactions })),
        );
    }

    private resolveConversationId(otherUserId: string): string | null {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) return null;
        return createConversationId(currentUser.uid, otherUserId);
    }

    private requireNonEmpty(value: string, errorMessage: string): string {
        return requireNonEmpty(value, errorMessage);
    }
}
