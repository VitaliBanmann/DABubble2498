import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { where, orderBy, Timestamp } from 'firebase/firestore';

export interface MessageReaction extends Record<string, unknown> {
    emoji: string;
    userIds: string[];
}

export interface Message extends Record<string, unknown> {
    id?: string;
    text: string;
    senderId: string;
    sender?: string;
    receiverId?: string;
    receiver?: string;
    channelId?: string;
    channel?: string;
    conversationId?: string;
    timestamp: Timestamp | Date;
    createdAt?: Timestamp | Date;
    read?: boolean;
    edited?: boolean;
    editedAt?: Date;
    reactions?: MessageReaction[];
}

@Injectable({
    providedIn: 'root',
})
export class MessageService {
    private messagesCollection = 'messages';

    constructor(
        private firestoreService: FirestoreService,
        private authService: AuthService,
    ) {}

    /**
     * Sende eine neue Nachricht
     */
    sendMessage(message: Message): Observable<string> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        if (currentUser.isAnonymous) {
            throw new Error('Anonymous users cannot send messages');
        }

        return this.firestoreService.addDocument(this.messagesCollection, {
            ...message,
            senderId: currentUser.uid,
            timestamp: new Date(),
            read: false,
        });
    }

    /**
     * Rufe Nachrichten für einen Kanal ab
     */
    getChannelMessages(channelId: string): Observable<Message[]> {
        const modern$ = this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'asc'),
            ])
            .pipe(catchError(() => of([])));

        const legacy$ = this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channel', '==', channelId),
            ])
            .pipe(catchError(() => of([])));

        return combineLatest([modern$, legacy$]).pipe(
            map(([modernMessages, legacyMessages]) =>
                this.mergeAndSortMessages([...modernMessages, ...legacyMessages]),
            ),
        );
    }

    /**
     * Rufe private Nachrichten zwischen zwei Benutzern ab
     */
    getPrivateMessages(otherUserId: string): Observable<Message[]> {
        return this.getDirectMessages(otherUserId);
    }

    getDirectMessages(otherUserId: string): Observable<Message[]> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            return of([]);
        }

        const conversationId = this.createConversationId(
            currentUser.uid,
            otherUserId,
        );

        const modern$ = this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('conversationId', '==', conversationId),
            ])
            .pipe(catchError(() => of([])));

        const legacySent$ = this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('sender', '==', currentUser.uid),
                where('receiver', '==', otherUserId),
            ])
            .pipe(catchError(() => of([])));

        const legacyReceived$ = this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('sender', '==', otherUserId),
                where('receiver', '==', currentUser.uid),
            ])
            .pipe(catchError(() => of([])));

        return combineLatest([modern$, legacySent$, legacyReceived$]).pipe(
            map(([modernMessages, legacySent, legacyReceived]) =>
                this.mergeAndSortMessages([
                    ...modernMessages,
                    ...legacySent,
                    ...legacyReceived,
                ]),
            ),
        );
    }

    sendDirectMessage(otherUserId: string, text: string): Observable<string> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        if (currentUser.isAnonymous) {
            throw new Error('Anonymous users cannot send messages');
        }

        const conversationId = this.createConversationId(
            currentUser.uid,
            otherUserId,
        );

        return this.firestoreService.addDocument(this.messagesCollection, {
            text,
            senderId: currentUser.uid,
            receiverId: otherUserId,
            conversationId,
            timestamp: new Date(),
            read: false,
        });
    }

    /**
     * Aktualisiere eine Nachricht
     */
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

    /**
     * Lösche eine Nachricht
     */
    deleteMessage(messageId: string): Observable<void> {
        return this.firestoreService.deleteDocument(
            this.messagesCollection,
            messageId,
        );
    }

    /**
     * Markiere eine Nachricht als gelesen
     */
    markAsRead(messageId: string): Observable<void> {
        return this.firestoreService.updateDocument(
            this.messagesCollection,
            messageId,
            { read: true },
        );
    }

    getAllMessages(): Observable<Message[]> {
        return this.firestoreService.getDocuments<Message>(this.messagesCollection);
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

                        const existing = (message.reactions ?? []).map((reaction) => ({
                            ...reaction,
                            userIds: [...reaction.userIds],
                        }));
                        const reactionIndex = existing.findIndex(
                            (reaction) => reaction.emoji === emoji,
                        );

                        if (reactionIndex >= 0) {
                            const target = existing[reactionIndex];
                            const hasReacted = target.userIds.includes(currentUser.uid);

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
                            existing.push({ emoji, userIds: [currentUser.uid] });
                        }

                        this.firestoreService
                            .updateDocument(this.messagesCollection, messageId, {
                                reactions: existing,
                            })
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

    private createConversationId(firstUserId: string, secondUserId: string): string {
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

    private mergeAndSortMessages(messages: Message[]): Message[] {
        const deduplicated = new Map<string, Message>();

        messages.forEach((message, index) => {
            const normalized = this.normalizeLegacyMessage(message);
            const key = normalized.id ?? `${normalized.senderId}-${normalized.text}-${index}`;
            deduplicated.set(key, normalized);
        });

        return Array.from(deduplicated.values()).sort(
            (left, right) =>
                this.toTimestampMillis(left.timestamp) -
                this.toTimestampMillis(right.timestamp),
        );
    }

    private normalizeLegacyMessage(message: Message): Message {
        const senderId = message.senderId || message.sender || '';
        const receiverId = message.receiverId || message.receiver;
        const channelId = message.channelId || message.channel;
        const timestamp = message.timestamp || message.createdAt || new Date(0);

        return {
            ...message,
            senderId,
            receiverId,
            channelId,
            timestamp,
        };
    }
}
