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

    override get messages(): Message[] { return this._messages; }
    override set messages(v: Message[]) { this._messages = v; }

    protected override startDirectLiveStream(userId: string): void {
        this.liveMessagesSubscription = this.createDirectLiveStream(userId).subscribe({
            next: (msgs) => this.applyLiveMessages(msgs),
            error: (e) => this.handleRouteMessageError(e),
        });
    }

    protected override startChannelLiveStream(channelId: string): void {
        this.liveMessagesSubscription = this.createChannelLiveStream(channelId).subscribe({
            next: (msgs) => this.applyLiveMessages(msgs),
            error: (e) => this.handleRouteMessageError(e),
        });
    }

    protected createDirectLiveStream(userId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestDirectMessages(userId, this.pageSize),
        );
    }

    protected createChannelLiveStream(channelId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestChannelMessages(channelId, this.pageSize),
        );
    }

    protected withRealtimeReconnect(stream$: Observable<Message[]>): Observable<Message[]> {
        return stream$.pipe(
            retry({
                count: 3,
                delay: (error, retryCount) => this.getReconnectDelay(error, retryCount),
            }),
        );
    }

    protected getReconnectDelay(error: unknown, retryCount: number): Observable<number> {
        if (!this.isTransientStreamError(error)) return throwError(() => error);
        this.connectionHint = 'Verbindung instabil. Erneuter Verbindungsversuch...';
        return timer(Math.min(500 * 2 ** (retryCount - 1), 3000));
    }

    protected isTransientStreamError(error: unknown): boolean {
        const code = this.extractFirebaseErrorCode(error);
        return ['aborted', 'cancelled', 'deadline-exceeded', 'internal', 'unavailable', 'unknown'].includes(code);
    }

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

    protected canLoadOlderMessages(): boolean {
        return !this.isLoadingMoreMessages && this.hasMoreMessages;
    }

    protected stopOlderLoading(): void {
        this.hasMoreMessages = false;
    }

    protected createOlderLoader(timestamp: Message['timestamp']): Observable<Message[]> {
        return this.isDirectMessage
            ? this.messageService.loadOlderDirectMessages(this.currentDirectUserId, timestamp, this.pageSize)
            : this.messageService.loadOlderChannelMessages(this.currentChannelId, timestamp, this.pageSize);
    }

    protected applyOlderMessages(older: Message[]): void {
        const normalized = this.sortMessagesByTimestamp(older);
        this.olderMessages = this.mergeUniqueMessages(this.olderMessages, normalized);
        this.hasMoreMessages = older.length >= this.pageSize;
        this.isLoadingMoreMessages = false;
        this.rebuildMessageList();
    }

    protected handleOlderLoadError(error: unknown): void {
        this.isLoadingMoreMessages = false;
        this.handleRouteMessageError(error);
    }

    protected captureOlderMessagesScroll(): void {
        const container = this.getMessageListElement();
        if (!container) return;
        this.pendingOlderScrollRestore = {
            previousScrollTop: container.scrollTop,
            previousScrollHeight: container.scrollHeight,
        };
    }

    protected applyLiveMessages(messages: Message[]): void {
        this.connectionHint = '';
        this.liveMessages = this.sortMessagesByTimestamp(messages);
        this.rebuildMessageList();
    }

    protected abstract rebuildMessageList(): void;

    protected updateRenderedMessageState(previousKey: string, wasNearBottom: boolean): void {
        const nextKey = this.getLastMessageKey(this.messages);
        const hasNewMessage = !!nextKey && nextKey !== previousKey;
        this.lastRenderedMessageKey = nextKey;
        if (this.pendingScrollToMessageId) return void this.tryScrollToMessage();
        if (this.pendingOlderScrollRestore) return this.restoreOlderMessagesScrollPosition();
        if (this.forceScrollToBottomOnNextRender || wasNearBottom) return this.scrollAfterRender();
        this.showScrollToLatestButton = hasNewMessage;
    }

    protected tryScrollToMessage(): void {}

    protected scrollAfterRender(): void {
        this.forceScrollToBottomOnNextRender = false;
        this.scrollToBottom();
    }

    protected getMessageListElement(): HTMLElement | null {
        return this.messageListRef?.nativeElement ?? null;
    }

    protected isNearBottom(): boolean {
        const container = this.getMessageListElement();
        if (!container) return true;
        return this.getDistanceFromBottom(container) <= this.nearBottomThresholdPx;
    }

    protected getDistanceFromBottom(container: HTMLElement): number {
        return container.scrollHeight - container.scrollTop - container.clientHeight;
    }

    protected getLastMessageKey(messages: Message[]): string {
        const last = messages[messages.length - 1];
        if (!last) return '';
        return last.id ?? this.trackMessage(messages.length - 1, last);
    }

    protected trackMessage(index: number, message: Message): string {
        if (message.id) return message.id;
        const ts = this.resolveTrackTimestamp(message.timestamp, index);
        return `${message.senderId}-${ts}-${message.text}`;
    }

    protected scrollToBottom(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            if (!container) return;
            container.scrollTop = container.scrollHeight;
            this.showScrollToLatestButton = false;
        }, 0);
    }

    protected restoreOlderMessagesScrollPosition(): void {
        setTimeout(() => {
            const snapshot = this.pendingOlderScrollRestore;
            const container = this.getMessageListElement();
            if (!container || !snapshot) return;
            this.restoreScrollPosition(container, snapshot);
        }, 0);
    }

    protected restoreScrollPosition(
        container: HTMLElement,
        snapshot: { previousScrollTop: number; previousScrollHeight: number },
    ): void {
        const delta = container.scrollHeight - snapshot.previousScrollHeight;
        container.scrollTop = snapshot.previousScrollTop + delta;
        this.pendingOlderScrollRestore = null;
    }

    onMessageListScroll(): void {
        if (this.isNearBottom()) this.showScrollToLatestButton = false;
    }

    scrollToLatestMessages(): void {
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

    protected resetMessageStreams(): void {
        this.resetLiveCollections();
        this.resetComposerTransientState();
        this.resetEditState();
    }

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

    protected resetComposerTransientState(): void {}
    protected resetEditState(): void {}

    protected prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
        this.forceScrollToBottomOnNextRender = true;
        this.showScrollToLatestButton = false;
        this.lastRenderedMessageKey = '';
    }

    protected abstract sortMessagesByTimestamp(messages: Message[]): Message[];
    protected abstract mergeUniqueMessages(a: Message[], b: Message[]): Message[];
    protected abstract resolveTrackTimestamp(ts: Message['timestamp'], fallback: number): number;
}
