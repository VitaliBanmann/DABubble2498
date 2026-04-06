import { Injectable } from '@angular/core';
import { ElementRef } from '@angular/core';
import {
    Observable,
    Subscription,
    throwError,
    timer,
    retry,
} from 'rxjs';
import { Message, MessageService } from '../services/message.service';
import { MessageGroup } from './home.component.models';
import { HomeRouteContextBase } from './home-route-context.base';

@Injectable()
export abstract class HomeMessageStreamsBase extends HomeRouteContextBase {
    private _messages: Message[] = [];
    messageGroups: MessageGroup[] = [];
    isLoadingMoreMessages = false;
    hasMoreMessages = true;
    showScrollToLatestButton = false;

    protected liveMessages: Message[] = [];
    protected olderMessages: Message[] = [];
    protected liveMessagesSubscription: Subscription | null = null;
    protected forceScrollToBottomOnNextRender = true;
    protected pendingOlderScrollRestore: {
        previousScrollTop: number;
        previousScrollHeight: number;
    } | null = null;
    protected lastRenderedMessageKey = '';
    protected pendingScrollToMessageId: string | null = null;

    protected readonly pageSize = 30;
    protected readonly nearBottomThresholdPx = 200;

    protected abstract messageListRef?: ElementRef<HTMLElement>;

    /** Returns messages. */
    override get messages(): Message[] { return this._messages; }
    /** Sets messages. */
    override set messages(v: Message[]) { this._messages = v; }

    /** Handles start direct live stream. */
    protected override startDirectLiveStream(userId: string): void {
        this.liveMessagesSubscription = this.createDirectLiveStream(userId).subscribe({
            next: (msgs) => this.applyLiveMessages(msgs),
            error: (e) => this.handleRouteMessageError(e),
        });
    }

    /** Handles start channel live stream. */
    protected override startChannelLiveStream(channelId: string): void {
        this.liveMessagesSubscription = this.createChannelLiveStream(channelId).subscribe({
            next: (msgs) => this.applyLiveMessages(msgs),
            error: (e) => this.handleRouteMessageError(e),
        });
    }

    /** Handles create direct live stream. */
    protected createDirectLiveStream(userId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestDirectMessages(userId, this.pageSize),
        );
    }

    /** Handles create channel live stream. */
    protected createChannelLiveStream(channelId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestChannelMessages(channelId, this.pageSize),
        );
    }

    /** Handles with realtime reconnect. */
    protected withRealtimeReconnect(stream$: Observable<Message[]>): Observable<Message[]> {
        return stream$.pipe(
            retry({
                count: 3,
                delay: (error, retryCount) => this.getReconnectDelay(error, retryCount),
            }),
        );
    }

    /** Handles get reconnect delay. */
    protected getReconnectDelay(error: unknown, retryCount: number): Observable<number> {
        if (!this.isTransientStreamError(error)) return throwError(() => error);
        this.connectionHint = 'Verbindung instabil. Erneuter Verbindungsversuch...';
        return timer(Math.min(500 * 2 ** (retryCount - 1), 3000));
    }

    /** Handles is transient stream error. */
    protected isTransientStreamError(error: unknown): boolean {
        const code = this.extractFirebaseErrorCode(error);
        return ['aborted', 'cancelled', 'deadline-exceeded', 'internal', 'unavailable', 'unknown'].includes(code);
    }

    /** Handles load older messages. */
    loadOlderMessages(): void {
        if (!this.canLoadOlderMessages()) return;
        const oldest = this.messages[0];
        if (!oldest?.timestamp) { this.stopOlderLoading(); return; }
        this.captureOlderMessagesScroll();
        this.isLoadingMoreMessages = true;
        this.createOlderLoader(oldest.timestamp).subscribe({
            next: (older) => this.applyOlderMessages(older),
            error: (e) => this.handleOlderLoadError(e),
        });
    }

    /** Handles can load older messages. */
    protected canLoadOlderMessages(): boolean {
        return !this.isLoadingMoreMessages && this.hasMoreMessages;
    }

    /** Handles stop older loading. */
    protected stopOlderLoading(): void {
        this.hasMoreMessages = false;
    }

    /** Handles create older loader. */
    protected createOlderLoader(timestamp: Message['timestamp']): Observable<Message[]> {
        return this.isDirectMessage
            ? this.messageService.loadOlderDirectMessages(this.currentDirectUserId, timestamp, this.pageSize)
            : this.messageService.loadOlderChannelMessages(this.currentChannelId, timestamp, this.pageSize);
    }

    /** Handles apply older messages. */
    protected applyOlderMessages(older: Message[]): void {
        const normalized = this.sortMessagesByTimestamp(older);
        this.olderMessages = this.mergeUniqueMessages(this.olderMessages, normalized);
        this.hasMoreMessages = older.length >= this.pageSize;
        this.isLoadingMoreMessages = false;
        this.rebuildMessageList();
    }

    /** Handles handle older load error. */
    protected handleOlderLoadError(error: unknown): void {
        this.isLoadingMoreMessages = false;
        this.handleRouteMessageError(error);
    }

    /** Handles capture older messages scroll. */
    protected captureOlderMessagesScroll(): void {
        const container = this.getMessageListElement();
        if (!container) return;
        this.pendingOlderScrollRestore = {
            previousScrollTop: container.scrollTop,
            previousScrollHeight: container.scrollHeight,
        };
    }

    /** Handles apply live messages. */
    protected applyLiveMessages(messages: Message[]): void {
        this.connectionHint = '';
        this.liveMessages = this.sortMessagesByTimestamp(messages);
        this.rebuildMessageList();
    }

    /** Handles rebuild message list. */
    protected abstract rebuildMessageList(): void;

    /** Handles update rendered message state. */
    protected updateRenderedMessageState(previousKey: string, wasNearBottom: boolean): void {
        const nextKey = this.getLastMessageKey(this.messages);
        const hasNewMessage = !!nextKey && nextKey !== previousKey;
        this.lastRenderedMessageKey = nextKey;
        if (this.pendingScrollToMessageId) return void this.tryScrollToMessage();
        if (this.pendingOlderScrollRestore) return this.restoreOlderMessagesScrollPosition();
        if (this.forceScrollToBottomOnNextRender || wasNearBottom) return this.scrollAfterRender();
        this.showScrollToLatestButton = hasNewMessage;
    }

    /** Handles try scroll to message. */
    protected tryScrollToMessage(): void {}

    /** Handles scroll after render. */
    protected scrollAfterRender(): void {
        this.forceScrollToBottomOnNextRender = false;
        this.scrollToBottom();
    }

    /** Handles get message list element. */
    protected getMessageListElement(): HTMLElement | null {
        return this.messageListRef?.nativeElement ?? null;
    }

    /** Handles is near bottom. */
    protected isNearBottom(): boolean {
        const container = this.getMessageListElement();
        if (!container) return true;
        return this.getDistanceFromBottom(container) <= this.nearBottomThresholdPx;
    }

    /** Handles get distance from bottom. */
    protected getDistanceFromBottom(container: HTMLElement): number {
        return container.scrollHeight - container.scrollTop - container.clientHeight;
    }

    /** Handles get last message key. */
    protected getLastMessageKey(messages: Message[]): string {
        const last = messages[messages.length - 1];
        if (!last) return '';
        return last.id ?? this.trackMessage(messages.length - 1, last);
    }

    /** Handles track message. */
    protected trackMessage(index: number, message: Message): string {
        if (message.id) return message.id;
        const ts = this.resolveTrackTimestamp(message.timestamp, index);
        return `${message.senderId}-${ts}-${message.text}`;
    }

    /** Handles scroll to bottom. */
    protected scrollToBottom(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            if (!container) return;
            container.scrollTop = container.scrollHeight;
            this.showScrollToLatestButton = false;
        }, 0);
    }

    /** Handles restore older messages scroll position. */
    protected restoreOlderMessagesScrollPosition(): void {
        setTimeout(() => {
            const snapshot = this.pendingOlderScrollRestore;
            const container = this.getMessageListElement();
            if (!container || !snapshot) return;
            this.restoreScrollPosition(container, snapshot);
        }, 0);
    }

    /** Handles restore scroll position. */
    protected restoreScrollPosition(
        container: HTMLElement,
        snapshot: { previousScrollTop: number; previousScrollHeight: number },
    ): void {
        const delta = container.scrollHeight - snapshot.previousScrollHeight;
        container.scrollTop = snapshot.previousScrollTop + delta;
        this.pendingOlderScrollRestore = null;
    }

    /** Handles on message list scroll. */
    onMessageListScroll(): void {
        if (this.isNearBottom()) this.showScrollToLatestButton = false;
    }

    /** Handles scroll to latest messages. */
    scrollToLatestMessages(): void {
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

    /** Handles reset message streams. */
    protected resetMessageStreams(): void {
        this.resetLiveCollections();
        this.resetComposerTransientState();
        this.resetEditState();
    }

    /** Handles reset live collections. */
    protected resetLiveCollections(): void {
        this.liveMessagesSubscription?.unsubscribe();
        this.liveMessagesSubscription = null;
        this.liveMessages = [];
        this.olderMessages = [];
        this.messages = [];
        this.messageGroups = [];
        this.hasMoreMessages = true;
        this.isLoadingMoreMessages = false;
    }

    /** Handles reset composer transient state. */
    protected resetComposerTransientState(): void {}
    /** Handles reset edit state. */
    protected resetEditState(): void {}

    /** Handles prepare message stream switch. */
    protected prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
        this.forceScrollToBottomOnNextRender = true;
        this.showScrollToLatestButton = false;
        this.lastRenderedMessageKey = '';
    }

    /** Handles sort messages by timestamp. */
    protected abstract sortMessagesByTimestamp(messages: Message[]): Message[];
    /** Handles merge unique messages. */
    protected abstract mergeUniqueMessages(a: Message[], b: Message[]): Message[];
    /** Handles resolve track timestamp. */
    protected abstract resolveTrackTimestamp(ts: Message['timestamp'], fallback: number): number;
}
