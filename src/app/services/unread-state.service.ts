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

    /** Handles mark channel as read. */
    markChannelAsRead(userId: string, channelId: string): Observable<void> {
        const contextId = this.channelContextId(channelId);
        return this.writeInboxState(userId, contextId, 'channel', channelId);
    }

    /** Handles mark direct as read. */
    markDirectAsRead(userId: string, otherUserId: string): Observable<void> {
        const conversationId = this.createConversationId(userId, otherUserId);
        const contextId = this.dmContextId(conversationId);
        return this.writeInboxState(userId, contextId, 'dm', otherUserId);
    }

    /** Handles watch unread flags. */
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
        if (!userId) return of(this.emptyFlags());
        const latestStreams = this.buildLatestStreams(userId, channelIds, dmUserIds);
        const mentionStreams = this.buildLatestMentionStreams(userId, channelIds, dmUserIds);
        if (!latestStreams.length) return of(this.emptyFlags());

        return combineLatest([this.inboxStateStream(userId), ...latestStreams, ...mentionStreams]).pipe(
            map(([states, ...rest]) =>
                this.mapFlagsResult(userId, states as InboxState[], rest, latestStreams.length),
            ),
            catchError(() => of(this.emptyFlags())),
        );
    }

    /** Handles inbox state stream. */
    private inboxStateStream(userId: string): Observable<InboxState[]> {
        return this.firestoreService.queryDocumentsRealtime<InboxState>(
            `users/${userId}/inboxState`,
            [],
        );
    }

    /** Handles build latest streams. */
    private buildLatestStreams(
        userId: string,
        channelIds: string[],
        dmUserIds: string[],
    ): Observable<LatestContextMessage>[] {
        return [
            ...this.buildChannelLatestStreams(channelIds),
            ...this.buildDirectLatestStreams(userId, dmUserIds),
        ];
    }

    /** Handles latest channel message. */
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

    /** Handles latest direct message. */
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

    /** Handles build latest mention streams. */
    private buildLatestMentionStreams(
        userId: string,
        channelIds: string[],
        dmUserIds: string[],
    ): Observable<LatestMentionMessage>[] {
        return [
            ...this.buildChannelMentionStreams(userId, channelIds),
            ...this.buildDirectMentionStreams(userId, dmUserIds),
        ];
    }

    /** Handles latest channel mention. */
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

    /** Handles latest direct mention. */
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

    /** Handles compute unread flags. */
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
        const channels: Record<string, boolean> = {};
        const direct: Record<string, boolean> = {};
        const channelMentions: Record<string, boolean> = {};
        const directMentions: Record<string, boolean> = {};
        const stateMap = this.buildStateMap(states);
        this.applyLatestUnread(userId, latest, stateMap, channels, direct);
        this.applyMentionUnread(mentions, stateMap, channelMentions, directMentions);
        return { channels, direct, channelMentions, directMentions };
    }

    /** Handles write inbox state. */
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

    /** Handles channel context id. */
    private channelContextId(channelId: string): string {
        return `channel:${channelId}`;
    }

    /** Handles dm context id. */
    private dmContextId(conversationId: string): string {
        return `dm:${conversationId}`;
    }

    /** Handles create conversation id. */
    private createConversationId(firstUserId: string, secondUserId: string): string {
        return [firstUserId, secondUserId].sort().join('__');
    }

    /** Handles to millis. */
    private toMillis(value: unknown): number {
        if (value instanceof Date) return value.getTime();
        if (this.hasToMillis(value)) return value.toMillis();
        if (this.hasToDate(value)) return value.toDate().getTime();
        return 0;
    }

    /** Handles empty flags. */
    private emptyFlags() {
        return { channels: {}, direct: {}, channelMentions: {}, directMentions: {} };
    }

    /** Handles map flags result. */
    private mapFlagsResult(
        userId: string,
        states: InboxState[],
        rest: unknown[],
        latestCount: number,
    ) {
        const latest = rest.slice(0, latestCount) as LatestContextMessage[];
        const mentions = rest.slice(latestCount) as LatestMentionMessage[];
        return this.computeUnreadFlags(userId, states, latest, mentions);
    }

    /** Handles build channel latest streams. */
    private buildChannelLatestStreams(channelIds: string[]): Observable<LatestContextMessage>[] {
        return channelIds.map((channelId) =>
            this.latestChannelMessage(channelId).pipe(map((message) => this.toLatestChannel(channelId, message))),
        );
    }

    /** Handles build direct latest streams. */
    private buildDirectLatestStreams(userId: string, dmUserIds: string[]): Observable<LatestContextMessage>[] {
        return dmUserIds.map((otherUserId) => {
            const conversationId = this.createConversationId(userId, otherUserId);
            return this.latestDirectMessage(conversationId).pipe(map((message) => this.toLatestDirect(otherUserId, conversationId, message)));
        });
    }

    /** Handles build channel mention streams. */
    private buildChannelMentionStreams(userId: string, channelIds: string[]): Observable<LatestMentionMessage>[] {
        return channelIds.map((channelId) =>
            this.latestChannelMention(channelId, userId).pipe(map((message) => this.toMentionChannel(channelId, message))),
        );
    }

    /** Handles build direct mention streams. */
    private buildDirectMentionStreams(userId: string, dmUserIds: string[]): Observable<LatestMentionMessage>[] {
        return dmUserIds.map((otherUserId) => {
            const conversationId = this.createConversationId(userId, otherUserId);
            return this.latestDirectMention(conversationId, userId).pipe(map((message) => this.toMentionDirect(otherUserId, conversationId, message)));
        });
    }

    /** Handles to latest channel. */
    private toLatestChannel(id: string, message: Message | null): LatestContextMessage {
        return { kind: 'channel', id, contextId: this.channelContextId(id), message };
    }

    /** Handles to latest direct. */
    private toLatestDirect(id: string, conversationId: string, message: Message | null): LatestContextMessage {
        return { kind: 'dm', id, contextId: this.dmContextId(conversationId), message };
    }

    /** Handles to mention channel. */
    private toMentionChannel(id: string, message: Message | null): LatestMentionMessage {
        return { kind: 'channel', id, contextId: this.channelContextId(id), message };
    }

    /** Handles to mention direct. */
    private toMentionDirect(id: string, conversationId: string, message: Message | null): LatestMentionMessage {
        return { kind: 'dm', id, contextId: this.dmContextId(conversationId), message };
    }

    /** Handles build state map. */
    private buildStateMap(states: InboxState[]): Record<string, InboxState> {
        return states.reduce<Record<string, InboxState>>((acc, state) => {
            if (state.contextId) acc[state.contextId] = state;
            return acc;
        }, {});
    }

    /** Handles apply latest unread. */
    private applyLatestUnread(
        userId: string,
        latest: LatestContextMessage[],
        stateMap: Record<string, InboxState>,
        channels: Record<string, boolean>,
        direct: Record<string, boolean>,
    ): void {
        latest.forEach((item) => {
            const unread = this.isLatestItemUnread(userId, item, stateMap[item.contextId]);
            if (item.kind === 'channel') channels[item.id] = unread;
            else direct[item.id] = unread;
        });
    }

    /** Handles apply mention unread. */
    private applyMentionUnread(
        mentions: LatestMentionMessage[],
        stateMap: Record<string, InboxState>,
        channelMentions: Record<string, boolean>,
        directMentions: Record<string, boolean>,
    ): void {
        mentions.forEach((item) => {
            const unread = this.isMentionItemUnread(item, stateMap[item.contextId]);
            if (item.kind === 'channel') channelMentions[item.id] = unread;
            else directMentions[item.id] = unread;
        });
    }

    /** Handles is latest item unread. */
    private isLatestItemUnread(userId: string, item: LatestContextMessage, state?: InboxState): boolean {
        const lastRead = state ? this.toMillis(state.lastReadAt) : 0;
        const messageTime = item.message ? this.toMillis(item.message.timestamp) : 0;
        const isOwn = item.message?.senderId === userId;
        return !!item.message && !isOwn && messageTime > lastRead;
    }

    /** Handles is mention item unread. */
    private isMentionItemUnread(item: LatestMentionMessage, state?: InboxState): boolean {
        const lastRead = state ? this.toMillis(state.lastReadAt) : 0;
        const messageTime = item.message ? this.toMillis(item.message.timestamp) : 0;
        return !!item.message && messageTime > lastRead;
    }

    /** Handles has to millis. */
    private hasToMillis(value: unknown): value is { toMillis: () => number } {
        return !!value && typeof value === 'object' && 'toMillis' in value && typeof (value as any).toMillis === 'function';
    }

    /** Handles has to date. */
    private hasToDate(value: unknown): value is { toDate: () => Date } {
        return !!value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function';
    }
}
