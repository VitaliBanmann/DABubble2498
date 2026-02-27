import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Observable, of } from 'rxjs';
import { query, where, orderBy, Timestamp } from 'firebase/firestore';

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
        return this.firestoreService.queryDocumentsRealtime<Message>(
            this.messagesCollection,
            [where('channelId', '==', channelId), orderBy('timestamp', 'asc')],
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

        return this.firestoreService.queryDocumentsRealtime<Message>(
            this.messagesCollection,
            [
                where('conversationId', '==', conversationId),
                orderBy('timestamp', 'asc'),
            ],
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
}
