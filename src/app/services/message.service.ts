import { Injectable } from '@angular/core';
import { where, Timestamp } from 'firebase/firestore';
import {
    Observable,
    catchError,
    combineLatest,
    map,
    of,
    throwError,
} from 'rxjs';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';

export interface MessageReaction extends Record<string, unknown> {
    emoji: string;
    userIds: string[];
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
}

@Injectable({
    providedIn: 'root',
})
export class MessageService {
    private messagesCollection = 'messages';
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

        if (!text) {
            throw new Error('Message text is empty');
        }

        if (!senderId) {
            throw new Error('Missing senderId');
        }

        return this.firestoreService.addDocument(this.messagesCollection, {
            ...message,
            text,
            senderId,
            timestamp: new Date(),
            read: false,
        });
    }

    getChannelMessages(channelId: string): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('channelId', '==', channelId),
            ])
            .pipe(
                map((messages) => this.mergeAndSortMessages(messages)),
                catchError((error) => this.logReadError('CHANNEL', error)),
            );
    }

    getPrivateMessages(otherUserId: string): Observable<Message[]> {
        return this.getDirectMessages(otherUserId);
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

    const sent$ = this.querySentMessages(
        currentUser.uid,
        otherUserId,
        conversationId,
    );

    const received$ = this.queryReceivedMessages(
        currentUser.uid,
        otherUserId,
        conversationId,
    );

    return combineLatest([sent$, received$]).pipe(
        map(([sent, received]) =>
            this.mergeAndSortMessages([...sent, ...received]),
        ),
    );
}

    private querySentMessages(
        senderId: string,
        receiverId: string,
        conversationId: string,
    ): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('senderId', '==', senderId),
                where('receiverId', '==', receiverId),
                where('conversationId', '==', conversationId),
            ])
            .pipe(catchError((error) => this.logReadError('DM_SENT', error)));
    }

    private queryReceivedMessages(
        receiverId: string,
        senderId: string,
        conversationId: string,
    ): Observable<Message[]> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>(this.messagesCollection, [
                where('senderId', '==', senderId),
                where('receiverId', '==', receiverId),
                where('conversationId', '==', conversationId),
            ])
            .pipe(
                catchError((error) => this.logReadError('DM_RECEIVED', error)),
            );
    }

    sendDirectMessage(
        otherUserId: string,
        text: string,
        senderId: string,
    ): Observable<string> {
        const cleanText = (text ?? '').trim();
        const cleanSenderId = (senderId ?? '').trim();

        if (!cleanSenderId) {
            throw new Error('Missing senderId');
        }

        if (!cleanText) {
            throw new Error('Message text is empty');
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
