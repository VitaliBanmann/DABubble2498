import { Injectable } from '@angular/core';
import { Message } from '../services/message.service';
import { MessageGroup } from './home.component.models';
import { HomeMessageStreamsBase } from './home-message-streams.base';

@Injectable()
export abstract class HomeMessageGroupsBase extends HomeMessageStreamsBase {
    readonly messageGroupWindowMs = 5 * 60 * 1000;

    /** Rebuilds the rendered message list and its grouped representation. */
    protected rebuildMessageList(): void {
        const wasNearBottom = this.isNearBottom();
        const previousKey = this.lastRenderedMessageKey;
        this.messages = this.mergeUniqueMessages(this.olderMessages, this.liveMessages);
        this.messageGroups = this.buildMessageGroups(this.messages);
        this.seedHelloWorldIfNeeded();
        this.updateRenderedMessageState(previousKey, wasNearBottom);
    }

    /**
     * Builds message groups from a chronologically ordered list of messages.
     * @param messages Source messages to group.
     * @returns Grouped messages for rendering.
     */
    protected buildMessageGroups(messages: Message[]): MessageGroup[] {
        const groups: MessageGroup[] = [];
        for (const message of messages) this.appendMessageGroup(groups, message);
        return groups;
    }

    /**
     * Appends a message to the latest group or creates a new one if needed.
     * @param groups Current list of groups.
     * @param message Message to append.
     */
    protected appendMessageGroup(groups: MessageGroup[], message: Message): void {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || this.shouldStartNewGroup(lastGroup, message)) {
            groups.push(this.createMessageGroup(message, groups.length));
            return;
        }
        lastGroup.messages.push(message);
    }

    /**
     * Checks whether the next message must start a new visual group.
     * @param current Current message group.
     * @param next Next message candidate.
     * @returns True if a new group should be started.
     */
    protected shouldStartNewGroup(current: MessageGroup, next: Message): boolean {
        const prev = current.messages[current.messages.length - 1] ?? null;
        if (!prev) return true;
        return (
            current.senderId !== next.senderId ||
            !this.isSameCalendarDay(this.toDate(prev.timestamp), this.toDate(next.timestamp)) ||
            !this.isWithinMessageGroupWindow(next.timestamp, prev.timestamp)
        );
    }

    /**
     * Creates a new message group for a single message.
     * @param message First message of the group.
     * @param index Fallback index used for deterministic id creation.
     * @returns The newly created message group.
     */
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

    /**
     * Determines whether a message was sent by the current user.
     * @param message Message to evaluate.
     * @returns True if the message belongs to the current user.
     */
    protected isOwnMessage(message: Message): boolean {
        return !!this.currentUserId && message.senderId === this.currentUserId;
    }

    /**
     * Merges two message arrays and removes duplicates by id or tracking key.
     * @param first First message list.
     * @param second Second message list.
     * @returns Unique messages sorted by timestamp.
     */
    protected mergeUniqueMessages(first: Message[], second: Message[]): Message[] {
        const merged = new Map<string, Message>();
        [...first, ...second].forEach((m, i) => {
            merged.set(m.id ?? this.trackMessage(i, m), m);
        });
        return this.sortMessagesByTimestamp(Array.from(merged.values()));
    }

    /**
     * Sorts messages by ascending timestamp.
     * @param messages Messages to sort.
     * @returns Sorted copy of the input array.
     */
    protected sortMessagesByTimestamp(messages: Message[]): Message[] {
        return [...messages].sort(
            (a, b) => this.toTimestampMillis(a.timestamp) - this.toTimestampMillis(b.timestamp),
        );
    }

    /**
     * Converts supported timestamp representations to epoch milliseconds.
     * @param timestamp Message timestamp value.
     * @returns Milliseconds since epoch or 0 if not convertible.
     */
    protected toTimestampMillis(timestamp: Message['timestamp']): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof (timestamp as any).toMillis === 'function')
            return (timestamp as any).toMillis();
        if ('toDate' in timestamp && typeof (timestamp as any).toDate === 'function')
            return (timestamp as any).toDate().getTime();
        return 0;
    }

    /**
     * Resolves a timestamp for stable fallback tracking keys.
     * @param timestamp Message timestamp value.
     * @param fallback Fallback value when no timestamp conversion is possible.
     * @returns Resolved timestamp in milliseconds or fallback.
     */
    protected resolveTrackTimestamp(timestamp: Message['timestamp'], fallback: number): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof (timestamp as any).toMillis === 'function')
            return (timestamp as any).toMillis();
        return fallback;
    }

    /**
     * Attempts to normalize a value into a valid Date.
     * @param value Unknown date-like value.
     * @returns A valid Date instance or null.
     */
    protected toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return this.asValidDate(value);
        if (this.hasToDate(value)) return this.asValidDate(value.toDate());
        if (typeof value === 'number' || typeof value === 'string')
            return this.asValidDate(new Date(value));
        return null;
    }

    /**
     * Type guard for objects exposing a toDate() function.
     * @param value Unknown input value.
     * @returns True if value has a callable toDate method.
     */
    protected hasToDate(value: unknown): value is { toDate: () => Date } {
        return typeof value === 'object' && !!value && 'toDate' in value &&
            typeof (value as any).toDate === 'function';
    }

    /**
     * Ensures a Date instance is valid.
     * @param value Date to validate.
     * @returns The same Date if valid, otherwise null.
     */
    protected asValidDate(value: Date): Date | null {
        return isNaN(value.getTime()) ? null : value;
    }

    /**
     * Converts a message timestamp to Date when a toDate method is available.
     * @param timestamp Message timestamp value.
     * @returns Converted Date or null.
     */
    protected tryToDate(timestamp: Message['timestamp']): Date | null {
        if ('toDate' in timestamp && typeof (timestamp as any).toDate === 'function')
            return (timestamp as any).toDate();
        return null;
    }

    /**
     * Compares two dates by calendar day (year, month, date).
     * @param a First date.
     * @param b Second date.
     * @returns True if both dates refer to the same day.
     */
    protected isSameCalendarDay(a: Date | null, b: Date | null): boolean {
        if (!a || !b) return false;
        return a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    /**
     * Checks whether two timestamps are within the grouping window.
     * @param cur Current message timestamp.
     * @param prev Previous message timestamp.
     * @returns True if both timestamps are ordered and close enough to be grouped.
     */
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

    /**
     * Determines whether a date separator should be rendered before a group.
     * @param index Index of the current group.
     * @param group Current message group.
     * @returns True when separator is required.
     */
    shouldShowGroupDateSeparator(index: number, group: MessageGroup): boolean {
        if (index === 0) return true;
        const cur = this.toDate(group.startedAt);
        const prev = this.toDate(this.messageGroups[index - 1]?.startedAt);
        return !this.isSameCalendarDay(cur, prev);
    }

    /**
     * Creates the localized label for a date separator.
     * @param timestamp Date-like value.
     * @returns "Heute", "Gestern" or a formatted calendar date.
     */
    getDateSeparatorLabel(timestamp: unknown): string {
        const date = this.toDate(timestamp);
        if (!date) return '';
        if (this.isSameCalendarDay(date, new Date())) return 'Heute';
        if (this.isSameCalendarDay(date, this.getYesterday())) return 'Gestern';
        return this.formatCalendarDate(date);
    }

    /**
     * Returns the Date value for yesterday in local time.
     * @returns Yesterday as Date.
     */
    protected getYesterday(): Date {
        const d = new Date(); d.setDate(d.getDate() - 1); return d;
    }

    /**
     * Formats a date for German calendar display.
     * @param date Date to format.
     * @returns Formatted date string.
     */
    protected formatCalendarDate(date: Date): string {
        return new Intl.DateTimeFormat('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        }).format(date);
    }

    /**
     * Formats a time in German locale.
     * @param date Date containing the time to format.
     * @returns Time string in HH:mm format.
     */
    protected formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Formats a timestamp as date separator label plus time.
     * @param timestamp Message timestamp value.
     * @returns Combined date and time string or empty string.
     */
    protected formatDateAndTime(timestamp: Message['timestamp']): string {
        const date = this.tryToDate(timestamp);
        return date ? `${this.getDateSeparatorLabel(date)} ${this.formatTime(date)}` : '';
    }

    /**
     * Formats a message timestamp for UI display.
     * @param timestamp Message timestamp value.
     * @returns Formatted time string or empty string.
     */
    formatTimestamp(timestamp: Message['timestamp']): string {
        if (!timestamp) return '';
        const date = timestamp instanceof Date ? timestamp : this.tryToDate(timestamp);
        return date ? this.formatTime(date) : '';
    }

    /**
     * Returns the last message in a message group.
     * @param group Message group.
     * @returns The final message or null when unavailable.
     */
    getLastMessageOfGroup(group: MessageGroup): Message | null {
        return group.messages[group.messages.length - 1] ?? null;
    }

    /** Hook for subclasses to seed initial demo/system messages. */
    protected seedHelloWorldIfNeeded(): void {}
}
