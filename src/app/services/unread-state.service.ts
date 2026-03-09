import { Injectable } from '@angular/core';
import { limit, orderBy, where } from 'firebase/firestore';
import { combineLatest, Observable, of, map, catchError } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { Message } from './message.service';

export interface InboxState extends Record<string, unknown> {
    id?: string;
    contextId: string;
    contextType: 'channel' | 'dm';
    targetId: string;
    lastReadAt: Date;
    updatedAt: Date;
}

interface LatestContextMessage {
    kind: 'channel' | 'dm';
    id: string;
    contextId: string;
    message: Message | null;
}

interface LatestMentionMessage {
    kind: 'channel' | 'dm';
    id: string;
    contextId: string;
    message: Message | null;
}

@Injectable({
    providedIn: 'root',
})
export class UnreadStateService {
    constructor(private readonly firestoreService: FirestoreService) {}

    markChannelAsRead(userId: string, channelId: string): Observable<void> {
        const contextId = this.channelContextId(channelId);
        return this.writeInboxState(userId, contextId, 'channel', channelId);
    }

    markDirectAsRead(userId: string, otherUserId: string): Observable<void> {
        const conversationId = this.createConversationId(userId, otherUserId);
        const contextId = this.dmContextId(conversationId);
        return this.writeInboxState(userId, contextId, 'dm', otherUserId);
    }

    watchUnreadFlags(
        userId: string,
        channelIds: string[],
        dmUserIds: string[],
    ): Observable<{
        channels: Record<string, boolean>;
        direct: Record<string, boolean>;
        channelMentions: Record<string, boolean>;
        directMentions: Record<string, boolean>;
    }> {
        if (!userId) {
            return of({
                channels: {},
                direct: {},
                channelMentions: {},
                directMentions: {},
            });
        }

        const states$ = this.firestoreService.queryDocumentsRealtime<InboxState>(
            `users/${userId}/inboxState`,
            [],
        );

        const latestStreams = this.buildLatestStreams(userId, channelIds, dmUserIds);
        const mentionStreams = this.buildLatestMentionStreams(userId, channelIds, dmUserIds);
        if (!latestStreams.length) {
            return of({
                channels: {},
                direct: {},
                channelMentions: {},
                directMentions: {},
            });
        }

        return combineLatest([states$, ...latestStreams, ...mentionStreams]).pipe(
            map(([states, ...rest]) => {
                const latest = rest.slice(0, latestStreams.length) as LatestContextMessage[];
                const mentions = rest.slice(latestStreams.length) as LatestMentionMessage[];
                return this.computeUnreadFlags(
                    userId,
                    states as InboxState[],
                    latest,
                    mentions,
                );
            },
            ),
            catchError(() =>
                of({
                    channels: {},
                    direct: {},
                    channelMentions: {},
                    directMentions: {},
                }),
            ),
        );
    }

    private buildLatestStreams(
        userId: string,
        channelIds: string[],
        dmUserIds: string[],
    ): Observable<LatestContextMessage>[] {
        const channelStreams = channelIds.map((channelId) =>
            this.latestChannelMessage(channelId).pipe(
                map((message) => ({
                    kind: 'channel' as const,
                    id: channelId,
                    contextId: this.channelContextId(channelId),
                    message,
                })),
            ),
        );

        const dmStreams = dmUserIds.map((otherUserId) => {
            const conversationId = this.createConversationId(userId, otherUserId);
            return this.latestDirectMessage(conversationId).pipe(
                map((message) => ({
                    kind: 'dm' as const,
                    id: otherUserId,
                    contextId: this.dmContextId(conversationId),
                    message,
                })),
            );
        });

        return [...channelStreams, ...dmStreams];
    }

    private latestChannelMessage(channelId: string): Observable<Message | null> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>('messages', [
                where('channelId', '==', channelId),
                orderBy('timestamp', 'desc'),
                limit(1),
            ])
            .pipe(
                map((messages) => messages[0] ?? null),
                catchError(() => of(null)),
            );
    }

    private latestDirectMessage(conversationId: string): Observable<Message | null> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>('messages', [
                where('conversationId', '==', conversationId),
                orderBy('timestamp', 'desc'),
                limit(1),
            ])
            .pipe(
                map((messages) => messages[0] ?? null),
                catchError(() => of(null)),
            );
    }

    private buildLatestMentionStreams(
        userId: string,
        channelIds: string[],
        dmUserIds: string[],
    ): Observable<LatestMentionMessage>[] {
        const channelStreams = channelIds.map((channelId) =>
            this.latestChannelMention(channelId, userId).pipe(
                map((message) => ({
                    kind: 'channel' as const,
                    id: channelId,
                    contextId: this.channelContextId(channelId),
                    message,
                })),
            ),
        );

        const dmStreams = dmUserIds.map((otherUserId) => {
            const conversationId = this.createConversationId(userId, otherUserId);
            return this.latestDirectMention(conversationId, userId).pipe(
                map((message) => ({
                    kind: 'dm' as const,
                    id: otherUserId,
                    contextId: this.dmContextId(conversationId),
                    message,
                })),
            );
        });

        return [...channelStreams, ...dmStreams];
    }

    private latestChannelMention(
        channelId: string,
        userId: string,
    ): Observable<Message | null> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>('messages', [
                where('channelId', '==', channelId),
                where('mentions', 'array-contains', userId),
                orderBy('timestamp', 'desc'),
                limit(1),
            ])
            .pipe(
                map((messages) => messages[0] ?? null),
                catchError(() => of(null)),
            );
    }

    private latestDirectMention(
        conversationId: string,
        userId: string,
    ): Observable<Message | null> {
        return this.firestoreService
            .queryDocumentsRealtime<Message>('messages', [
                where('conversationId', '==', conversationId),
                where('mentions', 'array-contains', userId),
                orderBy('timestamp', 'desc'),
                limit(1),
            ])
            .pipe(
                map((messages) => messages[0] ?? null),
                catchError(() => of(null)),
            );
    }

    private computeUnreadFlags(
        userId: string,
        states: InboxState[],
        latest: LatestContextMessage[],
        mentions: LatestMentionMessage[],
    ): {
        channels: Record<string, boolean>;
        direct: Record<string, boolean>;
        channelMentions: Record<string, boolean>;
        directMentions: Record<string, boolean>;
    } {
        const stateMap = states.reduce<Record<string, InboxState>>((acc, state) => {
            if (state.contextId) {
                acc[state.contextId] = state;
            }
            return acc;
        }, {});

        const channels: Record<string, boolean> = {};
        const direct: Record<string, boolean> = {};
        const channelMentions: Record<string, boolean> = {};
        const directMentions: Record<string, boolean> = {};

        latest.forEach((item) => {
            const state = stateMap[item.contextId];
            const lastRead = state ? this.toMillis(state.lastReadAt) : 0;
            const messageTime = item.message ? this.toMillis(item.message.timestamp) : 0;
            const isOwn = item.message?.senderId === userId;
            const unread = !!item.message && !isOwn && messageTime > lastRead;

            if (item.kind === 'channel') {
                channels[item.id] = unread;
                return;
            }

            direct[item.id] = unread;
        });

        mentions.forEach((item) => {
            const state = stateMap[item.contextId];
            const lastRead = state ? this.toMillis(state.lastReadAt) : 0;
            const messageTime = item.message ? this.toMillis(item.message.timestamp) : 0;
            const mentionUnread = !!item.message && messageTime > lastRead;

            if (item.kind === 'channel') {
                channelMentions[item.id] = mentionUnread;
                return;
            }

            directMentions[item.id] = mentionUnread;
        });

        return { channels, direct, channelMentions, directMentions };
    }

    private writeInboxState(
        userId: string,
        contextId: string,
        contextType: 'channel' | 'dm',
        targetId: string,
    ): Observable<void> {
        const now = new Date();
        return this.firestoreService.setDocument(`users/${userId}/inboxState`, contextId, {
            contextId,
            contextType,
            targetId,
            lastReadAt: now,
            updatedAt: now,
        });
    }

    private channelContextId(channelId: string): string {
        return `channel:${channelId}`;
    }

    private dmContextId(conversationId: string): string {
        return `dm:${conversationId}`;
    }

    private createConversationId(firstUserId: string, secondUserId: string): string {
        return [firstUserId, secondUserId].sort().join('__');
    }

    private toMillis(value: unknown): number {
        if (value instanceof Date) {
            return value.getTime();
        }

        if (
            value &&
            typeof value === 'object' &&
            'toMillis' in value &&
            typeof (value as { toMillis?: unknown }).toMillis === 'function'
        ) {
            return ((value as { toMillis: () => number }).toMillis());
        }

        if (
            value &&
            typeof value === 'object' &&
            'toDate' in value &&
            typeof (value as { toDate?: unknown }).toDate === 'function'
        ) {
            return ((value as { toDate: () => Date }).toDate()).getTime();
        }

        return 0;
    }
}
