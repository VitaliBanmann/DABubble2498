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

interface ToggleReactionParams {
    messageId: string;
    emoji: string;
    isDirectMessage: boolean;
    channelId?: string;
    directUserId?: string;
}

@Injectable({
    providedIn: 'root',
})
export class MessageService {
    private messagesCollection = 'messages';
    private readonly defaultPageSize = 30;
    /** Handles log read error. */
    private logReadError(scope: string, error: unknown): Observable<never> {
        console.error(`[${scope}] Firestore read failed`, error);
        return throwError(() => error);
    }

    constructor(
        private firestoreService: FirestoreService,
        private authService: AuthService,
    ) {}

    /** Handles send message. */
    sendMessage(message: Message): Observable<string> {
        return this.firestoreService.addDocument(
            this.messagesCollection,
            buildMessagePayload(message),
        );
    }

    /** Handles create message id. */
    createMessageId(): string {
        return this.firestoreService.createDocumentId(this.messagesCollection);
    }

    /** Handles send message with id. */
    sendMessageWithId(messageId: string, message: Message): Observable<string> {
        const payload = buildMessagePayload(message);
        return this.firestoreService
            .setDocument(this.messagesCollection, messageId, payload)
            .pipe(map(() => messageId));
    }

    /** Handles get channel messages. */
    getChannelMessages(channelId: string): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'asc'),
            ])
            .pipe(catchError((error) => this.logReadError('CHANNEL', error)));
    }

    /** Handles get private messages. */
    getPrivateMessages(otherUserId: string): Observable<Message[]> {
        return this.getDirectMessages(otherUserId);
    }

    /** Handles stream latest channel messages. */
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

    /** Handles load older channel messages. */
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

    /** Handles get direct messages. */
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

    /** Handles stream latest direct messages. */
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

    /** Handles load older direct messages. */
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

    /** Handles send direct message. */
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

    /** Handles search channel messages by token. */
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

    /** Handles send direct message with id. */
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

    /** Handles update message. */
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

    /** Handles delete message. */
    deleteMessage(messageId: string): Observable<void> {
        return this.firestoreService.deleteDocument(
            this.messagesCollection,
            messageId,
        );
    }

    /** Handles mark as read. */
    markAsRead(messageId: string): Observable<void> {
        return this.firestoreService.updateDocument(
            this.messagesCollection,
            messageId,
            { read: true },
        );
    }

    /** Handles get all messages. */
    getAllMessages(): Observable<Message[]> {
        return this.firestoreService.getDocuments<Message>(
            this.messagesCollection,
        );
    }

    /** Handles search messages by token. */
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

    /** Handles get thread messages. */
    getThreadMessages(
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

    /** Handles get channel thread messages. */
    getChannelThreadMessages(parentMessageId: string): Observable<ThreadMessage[]> {
        return this.getThreadMessages(parentMessageId);
    }

    /** Handles send thread message. */
    sendThreadMessage(
        parentMessageId: string,
        text: string,
        senderId: string,
    ): Observable<string> {
        const cleanParentMessageId = this.requireNonEmpty(parentMessageId, 'Missing parentMessageId');
        const cleanText = this.requireNonEmpty(text, 'Thread message text is empty');
        const cleanSenderId = this.requireNonEmpty(senderId, 'Missing senderId');
        return this.firestoreService.addDocument(
            `messages/${cleanParentMessageId}/threads`,
            {
                text: cleanText,
                senderId: cleanSenderId,
                timestamp: new Date(),
            },
        );
    }

    /** Handles send channel thread message. */
    sendChannelThreadMessage(
        parentMessageId: string,
        text: string,
        senderId: string,
    ): Observable<string> {
        return this.sendThreadMessage(parentMessageId, text, senderId);
    }

    /** Handles toggle reaction. */
    toggleReaction(params: ToggleReactionParams): Observable<void> {
        const { messageId, emoji } = params;

        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) throw new Error('User not authenticated');

        return this.firestoreService
            .getDocument<Message>(this.messagesCollection, messageId)
            .pipe(
                map((message) => {
                    return computeUpdatedReactions(message, emoji, currentUser.uid);
                }),
                switchMap((reactions) =>
                    this.firestoreService.updateDocument(
                        this.messagesCollection,
                        messageId,
                        { reactions },
                    ),
                ),
            );
    }

    /** Handles resolve conversation id. */
    private resolveConversationId(otherUserId: string): string | null {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser || !otherUserId) return null;
        return createConversationId(currentUser.uid, otherUserId);
    }

    /** Handles require non empty. */
    private requireNonEmpty(value: string, errorMessage: string): string {
        return requireNonEmpty(value, errorMessage);
    }
}
