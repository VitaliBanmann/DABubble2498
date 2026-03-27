import { Injectable } from '@angular/core';
import { Message } from '../services/message.service';
import { MessageGroup } from './home.component.models';
import { HomeMessageStreamsBase } from './home-message-streams.base';

@Injectable()
export abstract class HomeMessageGroupsBase extends HomeMessageStreamsBase {
    readonly messageGroupWindowMs = 5 * 60 * 1000;

    protected rebuildMessageList(): void {
        const wasNearBottom = this.isNearBottom();
        const previousKey = this.lastRenderedMessageKey;
        this.messages = this.mergeUniqueMessages(this.olderMessages, this.liveMessages);
        this.messageGroups = this.buildMessageGroups(this.messages);
        this.seedHelloWorldIfNeeded();
        this.updateRenderedMessageState(previousKey, wasNearBottom);
    }

    protected buildMessageGroups(messages: Message[]): MessageGroup[] {
        const groups: MessageGroup[] = [];
        for (const message of messages) this.appendMessageGroup(groups, message);
        return groups;
    }

    protected appendMessageGroup(groups: MessageGroup[], message: Message): void {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || this.shouldStartNewGroup(lastGroup, message)) {
            groups.push(this.createMessageGroup(message, groups.length));
            return;
        }
        lastGroup.messages.push(message);
    }

    protected shouldStartNewGroup(current: MessageGroup, next: Message): boolean {
        const prev = current.messages[current.messages.length - 1] ?? null;
        if (!prev) return true;
        return (
            current.senderId !== next.senderId ||
            !this.isSameCalendarDay(this.toDate(prev.timestamp), this.toDate(next.timestamp)) ||
            !this.isWithinMessageGroupWindow(next.timestamp, prev.timestamp)
        );
    }

    protected createMessageGroup(message: Message, index: number): MessageGroup {
        const fallbackId =
            message.id ??
            `${message.senderId}-${index}-${this.resolveTrackTimestamp(message.timestamp, index)}`;
        return {
            id: fallbackId,
            senderId: message.senderId,
            isOwn: this.isOwnMessage(message),
            startedAt: message.timestamp,
            messages: [message],
        };
    }

    protected isOwnMessage(message: Message): boolean {
        return !!this.currentUserId && message.senderId === this.currentUserId;
    }

    protected mergeUniqueMessages(first: Message[], second: Message[]): Message[] {
        const merged = new Map<string, Message>();
        [...first, ...second].forEach((m, i) => {
            merged.set(m.id ?? this.trackMessage(i, m), m);
        });
        return this.sortMessagesByTimestamp(Array.from(merged.values()));
    }

    protected sortMessagesByTimestamp(messages: Message[]): Message[] {
        return [...messages].sort(
            (a, b) => this.toTimestampMillis(a.timestamp) - this.toTimestampMillis(b.timestamp),
        );
    }

    protected toTimestampMillis(timestamp: Message['timestamp']): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof (timestamp as any).toMillis === 'function')
            return (timestamp as any).toMillis();
        if ('toDate' in timestamp && typeof (timestamp as any).toDate === 'function')
            return (timestamp as any).toDate().getTime();
        return 0;
    }

    protected resolveTrackTimestamp(timestamp: Message['timestamp'], fallback: number): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof (timestamp as any).toMillis === 'function')
            return (timestamp as any).toMillis();
        return fallback;
    }

    protected toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return this.asValidDate(value);
        if (this.hasToDate(value)) return this.asValidDate(value.toDate());
        if (typeof value === 'number' || typeof value === 'string')
            return this.asValidDate(new Date(value));
        return null;
    }

    protected hasToDate(value: unknown): value is { toDate: () => Date } {
        return typeof value === 'object' && !!value && 'toDate' in value &&
            typeof (value as any).toDate === 'function';
    }

    protected asValidDate(value: Date): Date | null {
        return isNaN(value.getTime()) ? null : value;
    }

    protected tryToDate(timestamp: Message['timestamp']): Date | null {
        if ('toDate' in timestamp && typeof (timestamp as any).toDate === 'function')
            return (timestamp as any).toDate();
        return null;
    }

    protected isSameCalendarDay(a: Date | null, b: Date | null): boolean {
        if (!a || !b) return false;
        return a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    protected isWithinMessageGroupWindow(
        cur: Message['timestamp'],
        prev: Message['timestamp'],
    ): boolean {
        const curDate = this.toDate(cur);
        const prevDate = this.toDate(prev);
        if (!curDate || !prevDate) return false;
        const diff = curDate.getTime() - prevDate.getTime();
        return diff >= 0 && diff <= this.messageGroupWindowMs;
    }

    shouldShowGroupDateSeparator(index: number, group: MessageGroup): boolean {
        if (index === 0) return true;
        const cur = this.toDate(group.startedAt);
        const prev = this.toDate(this.messageGroups[index - 1]?.startedAt);
        return !this.isSameCalendarDay(cur, prev);
    }

    getDateSeparatorLabel(timestamp: unknown): string {
        const date = this.toDate(timestamp);
        if (!date) return '';
        if (this.isSameCalendarDay(date, new Date())) return 'Heute';
        if (this.isSameCalendarDay(date, this.getYesterday())) return 'Gestern';
        return this.formatCalendarDate(date);
    }

    protected getYesterday(): Date {
        const d = new Date(); d.setDate(d.getDate() - 1); return d;
    }

    protected formatCalendarDate(date: Date): string {
        return new Intl.DateTimeFormat('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        }).format(date);
    }

    protected formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    protected formatDateAndTime(timestamp: Message['timestamp']): string {
        const date = this.tryToDate(timestamp);
        return date ? `${this.getDateSeparatorLabel(date)} ${this.formatTime(date)}` : '';
    }

    formatTimestamp(timestamp: Message['timestamp']): string {
        if (!timestamp) return '';
        const date = timestamp instanceof Date ? timestamp : this.tryToDate(timestamp);
        return date ? this.formatTime(date) : '';
    }

    getLastMessageOfGroup(group: MessageGroup): Message | null {
        return group.messages[group.messages.length - 1] ?? null;
    }

    protected seedHelloWorldIfNeeded(): void {}
}
