import { Injectable } from '@angular/core';
import { Message, ThreadMessage } from '../services/message.service';
import { HomeSendMessageBase } from './home-send-message.base';

@Injectable()
export abstract class HomeReactionsThreadBase extends HomeSendMessageBase {
    private threadReplyCountByMessageId: Record<string, number> = {};
    private loadingThreadReplyCounts = new Set<string>();
    private threadReplyCountSubscriptions: Record<string, any> = {};

    protected abstract activeThreadParent: Message | null;
    abstract openThreadForMessage(message: Message): void;

    protected resetThreadReplyTracking(): void {
        this.clearThreadReplyCountSubscriptions();
        this.threadReplyCountByMessageId = {};
        this.loadingThreadReplyCounts.clear();
    }

    canOpenThreadFromToolbar(message: Message): boolean {
        return !!message.id;
    }

    getThreadReplyCount(message: Message): number {
        const messageId = message.id ?? '';
        if (messageId && messageId in this.threadReplyCountByMessageId) {
            return this.threadReplyCountByMessageId[messageId];
        }

        const count = this.resolveThreadReplyCount(message);
        if (messageId) this.ensureThreadReplyCountSynced(messageId);
        return count;
    }

    shouldShowThreadRepliesLink(message: Message): boolean {
        return this.getThreadReplyCount(message) > 0;
    }

    onThreadRepliesClick(event: MouseEvent, message: Message): void {
        event.preventDefault();
        this.openThreadForMessage(message);
    }

    isThreadParent(message: Message): boolean {
        return !!message.id && message.id === this.activeThreadParent?.id;
    }

    protected override tryScrollToMessage(): void {
        const msgId = this.pendingScrollToMessageId;
        if (!msgId) return;
        setTimeout(() => this.highlightScrolledMessage(msgId), 400);
    }

    protected highlightScrolledMessage(msgId: string): void {
        const el = document.getElementById('msg-' + msgId);
        if (!el) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message__line--highlight');
        this.pendingScrollToMessageId = null;
        setTimeout(() => el.classList.remove('message__line--highlight'), 2500);
    }

    private resolveThreadReplyCount(message: Message): number {
        const countValue = message.threadReplyCount ?? (message as any).threadCount ?? 0;
        const count = typeof countValue === 'number' ? countValue : Number(countValue);
        return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    }

    private ensureThreadReplyCountSynced(messageId: string): void {
        if (!this.canStartThreadReplySync(messageId)) return;
        this.loadingThreadReplyCounts.add(messageId);
        this.threadReplyCountSubscriptions[messageId] = this.messageService
            .getThreadMessages(messageId)
            .subscribe(this.threadReplySyncObserver(messageId));
    }

    private canStartThreadReplySync(messageId: string): boolean {
        return (
            !this.threadReplyCountSubscriptions[messageId]
            && !this.loadingThreadReplyCounts.has(messageId)
        );
    }

    private threadReplySyncObserver(messageId: string) {
        return {
            next: (threadMessages: ThreadMessage[]) => {
                this.threadReplyCountByMessageId[messageId] = threadMessages.length;
                this.loadingThreadReplyCounts.delete(messageId);
            },
            error: () => this.onThreadReplySyncError(messageId),
        };
    }

    private onThreadReplySyncError(messageId: string): void {
        this.loadingThreadReplyCounts.delete(messageId);
        const sub = this.threadReplyCountSubscriptions[messageId];
        sub?.unsubscribe();
        delete this.threadReplyCountSubscriptions[messageId];
    }

    private clearThreadReplyCountSubscriptions(): void {
        Object.values(this.threadReplyCountSubscriptions).forEach((sub: any) => sub.unsubscribe());
        this.threadReplyCountSubscriptions = {};
    }
}