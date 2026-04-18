import { Injectable } from '@angular/core';
import { Message, MessageReaction, ThreadMessage } from '../services/message.service';
import { computeUpdatedReactions } from '../services/message.helpers';
import { HomeSendMessageBase } from './home-send-message.base';

@Injectable()
export abstract class HomeReactionsBase extends HomeSendMessageBase {
    activeEmojiPicker:
        | { type: 'composer' }
        | { type: 'message'; messageId: string; source: 'toolbar' | 'reactions' }
        | null = null;

    readonly defaultToolbarReactionEmojis = ['✅', '🎉'];

    private readonly collapsedReactionLimit = 7;
    private expandedReactionMessages = new Set<string>();
    private threadReplyCountByMessageId: Record<string, number> = {};
    private loadingThreadReplyCounts = new Set<string>();
    private threadReplyCountSubscriptions: Record<string, any> = {};

    protected readonly mobileToolbarBreakpointPx = 770;
    mobileActiveMessageToolbarId: string | null = null;

    /**
     * Speichert pro Message + Quelle, ob der Picker oberhalb oder unterhalb geöffnet werden soll.
     * Key-Format: `${messageId}::${source}`
     */
    private messageEmojiPickerPlacement: Record<string, 'above' | 'below'> = {};

    /**
     * Grobe Picker-Höhe zur Platzberechnung.
     * Lieber etwas konservativer rechnen.
     */
    private readonly estimatedEmojiPickerHeightPx = 360;

    /**
     * Zusätzlicher Abstand unterhalb des Headers.
     */
    private readonly emojiPickerSafetyOffsetPx = 12;

    protected abstract triggerViewUpdate(): void;
    protected abstract activeThreadParent: Message | null;
    abstract openThreadForMessage(message: Message): void;

    protected resetThreadReplyTracking(): void {
        this.clearThreadReplyCountSubscriptions();
        this.threadReplyCountByMessageId = {};
        this.loadingThreadReplyCounts.clear();
    }

    isReactionListExpanded(message: Message): boolean {
        return !!message.id && this.expandedReactionMessages.has(message.id);
    }

    getVisibleReactions(message: Message): MessageReaction[] {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return reactions;
        return reactions.slice(0, this.collapsedReactionLimit);
    }

    getSortedVisibleReactions(message: Message): MessageReaction[] {
        return [...this.getVisibleReactions(message)].sort((a, b) => {
            const aR = this.hasCurrentUserReacted(a) ? 1 : 0;
            const bR = this.hasCurrentUserReacted(b) ? 1 : 0;
            if (aR !== bR) return bR - aR;

            const aC = typeof a.count === 'number' ? a.count : Number(a.count ?? 0);
            const bC = typeof b.count === 'number' ? b.count : Number(b.count ?? 0);
            return bC - aC;
        });
    }

    getHiddenReactionCount(message: Message): number {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return 0;
        return Math.max(reactions.length - this.collapsedReactionLimit, 0);
    }

    toggleReactionList(message: Message): void {
        if (!message.id) return;

        if (this.expandedReactionMessages.has(message.id)) {
            this.expandedReactionMessages.delete(message.id);
        } else {
            this.expandedReactionMessages.add(message.id);
        }
    }

    toggleReaction(message: Message, emoji: string): void {
        if (!this.canWrite || !message.id || !this.currentUserId) return;

        const previousReactions = this.cloneReactionState(message.reactions ?? []);
        const nextReactions = computeUpdatedReactions(message, emoji, this.currentUserId);

        this.applyOptimisticReactionUpdate(message, nextReactions);

        this.messageService
            .toggleReaction({
                messageId: message.id,
                emoji,
                isDirectMessage: this.isDirectMessage,
            })
            .subscribe({
                error: () => {
                    this.applyOptimisticReactionUpdate(message, previousReactions);
                    this.errorMessage = 'Reaktion konnte nicht aktualisiert werden.';
                },
            });
    }

    protected applyOptimisticReactionUpdate(
        message: Message,
        reactions: MessageReaction[],
    ): void {
        const messageId = message.id;
        if (!messageId) return;

        const clonedReactions = this.cloneReactionState(reactions);
        this.applyReactionStateToMessageCollections(message, messageId, clonedReactions);
        this.triggerViewUpdate();
    }

    protected replaceMessageReactions(
        messages: Message[],
        messageId: string,
        reactions: MessageReaction[],
    ): Message[] {
        return messages.map((entry) =>
            entry.id === messageId
                ? { ...entry, reactions: this.cloneReactionState(reactions) }
                : entry,
        );
    }

    protected cloneReactionState(reactions: MessageReaction[]): MessageReaction[] {
        return reactions.map((reaction) => ({
            ...reaction,
            userIds: [...reaction.userIds],
        }));
    }

    protected applyLocalReactionUpdate(
        messageId: string,
        reactions: MessageReaction[],
    ): void {
        this.liveMessages = this.updateReactionStateInMessages(
            this.liveMessages,
            messageId,
            reactions,
        );
        this.olderMessages = this.updateReactionStateInMessages(
            this.olderMessages,
            messageId,
            reactions,
        );
        this.messages = this.updateReactionStateInMessages(
            this.messages,
            messageId,
            reactions,
        );

        if (this.activeThreadParent?.id === messageId) {
            this.activeThreadParent = { ...this.activeThreadParent, reactions };
        }

        this.rebuildMessageList();
    }

    protected updateReactionStateInMessages(
        messages: Message[],
        messageId: string,
        reactions: MessageReaction[],
    ): Message[] {
        return messages.map((item) =>
            item.id === messageId
                ? {
                    ...item,
                    reactions: reactions.map((reaction) => ({
                        ...reaction,
                        userIds: [...reaction.userIds],
                    })),
                }
                : item,
        );
    }

    hasCurrentUserReacted(reaction: MessageReaction): boolean {
        return !!this.currentUserId && reaction.userIds.includes(this.currentUserId);
    }

    protected getReactionUserDisplayName(userId: string): string {
        if (!userId) return 'Unbekannt';
        if (userId === this.currentUserId) return 'Du';

        const displayName = (this.usersById[userId]?.displayName ?? '').trim();
        return displayName || userId;
    }

    getReactionUserDisplayNames(reaction: MessageReaction): string[] {
        const names = (reaction.userIds ?? [])
            .map((userId) => this.getReactionUserDisplayName(userId))
            .filter((name) => !!name);

        const uniqueNames = Array.from(new Set(names));

        return uniqueNames.sort((a, b) => {
            if (a === 'Du') return -1;
            if (b === 'Du') return 1;
            return a.localeCompare(b, 'de');
        });
    }

    getReactionTooltipLabel(reaction: MessageReaction): string {
        const names = this.getReactionUserDisplayNames(reaction);
        return names.length
            ? `${reaction.emoji} reagiert von ${names.join(', ')}`
            : `${reaction.emoji} Reaktion`;
    }

    canOpenThreadFromToolbar(message: Message): boolean {
        return !!message.id;
    }

    getThreadReplyCount(message: Message): number {
        const messageId = message.id ?? '';

        if (messageId && messageId in this.threadReplyCountByMessageId) {
            return this.threadReplyCountByMessageId[messageId];
        }

        const countValue = message.threadReplyCount ?? (message as any).threadCount ?? 0;
        const count =
            typeof countValue === 'number' ? countValue : Number(countValue);
        const normalized =
            Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

        if (messageId) this.ensureThreadReplyCountSynced(messageId);

        return normalized;
    }

    shouldShowThreadRepliesLink(message: Message): boolean {
        return this.getThreadReplyCount(message) > 0;
    }

    onThreadRepliesClick(event: MouseEvent, message: Message): void {
        event.preventDefault();
        this.openThreadForMessage(message);
    }

    isMobileToolbarMode(): boolean {
        return (
            typeof window !== 'undefined' &&
            window.innerWidth <= this.mobileToolbarBreakpointPx
        );
    }

    toggleMobileMessageToolbar(message: Message, event?: MouseEvent): void {
        if (!this.isMobileToolbarMode() || !message.id) return;

        event?.stopPropagation();

        this.mobileActiveMessageToolbarId =
            this.mobileActiveMessageToolbarId === message.id ? null : message.id;
    }

    isMessageToolbarVisible(message: Message): boolean {
        if (!message.id) return false;
        if (!this.isMobileToolbarMode()) return true;
        return this.mobileActiveMessageToolbarId === message.id;
    }

    closeMobileMessageToolbar(): void {
        this.mobileActiveMessageToolbarId = null;
    }

    toggleComposerEmojiPicker(event: MouseEvent): void {
        event.stopPropagation();

        if (this.activeEmojiPicker?.type === 'composer') {
            this.closeAllEmojiPickers();
        } else {
            this.activeEmojiPicker = { type: 'composer' };
        }
    }

    toggleMessageEmojiPicker(
        message: Message,
        source: 'toolbar' | 'reactions',
        event: MouseEvent,
    ): void {
        event.stopPropagation();

        if (!message.id || !this.canWrite) return;

        if (this.isMessageEmojiPickerOpen(message, source)) {
            this.closeAllEmojiPickers();
            return;
        }

        const placement = this.resolveMessageEmojiPickerPlacement(event.currentTarget as HTMLElement | null);

        this.setMessageEmojiPickerPlacement(message.id, source, placement);

        this.activeEmojiPicker = {
            type: 'message',
            messageId: message.id,
            source,
        };
    }

    isComposerEmojiPickerOpen(): boolean {
        return this.activeEmojiPicker?.type === 'composer';
    }

    isMessageEmojiPickerOpen(
        message: Message,
        source?: 'toolbar' | 'reactions',
    ): boolean {
        if (!message.id || this.activeEmojiPicker?.type !== 'message') return false;
        if (this.activeEmojiPicker.messageId !== message.id) return false;
        if (!source) return true;
        return this.activeEmojiPicker.source === source;
    }

    /**
     * Liefert true, wenn der Picker für diese Message/Quelle unterhalb geöffnet werden soll.
     */
    shouldOpenMessageEmojiPickerBelow(
        message: Message,
        source: 'toolbar' | 'reactions',
    ): boolean {
        if (!message.id) return false;
        return this.getMessageEmojiPickerPlacement(message.id, source) === 'below';
    }

    closeAllEmojiPickers(): void {
        this.activeEmojiPicker = null;
    }

    closeComposerEmojiPicker(): void {
        this.closeAllEmojiPickers();
    }

    onComposerEmojiSelect(event: any): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!emoji || !textarea) return;

        const next = this.insertComposerEmoji(textarea, emoji);

        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = next;
            this.resizeComposerTextarea();
        }, 0);

        this.closeAllEmojiPickers();
    }

    protected insertComposerEmoji(
        textarea: HTMLTextAreaElement,
        emoji: string,
    ): number {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = this.messageControlValue ?? '';

        this.setMessageControlValue(
            value.substring(0, start) + emoji + value.substring(end),
        );

        return start + emoji.length;
    }

    onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) return;

        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

    hasMentionForCurrentUser(message: Message): boolean {
        return (
            !!this.currentUserId &&
            (message.mentions ?? []).includes(this.currentUserId)
        );
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

    private ensureThreadReplyCountSynced(messageId: string): void {
        if (!this.canStartThreadReplySync(messageId)) return;

        this.loadingThreadReplyCounts.add(messageId);

        this.threadReplyCountSubscriptions[messageId] = this.messageService
            .getThreadMessages(messageId)
            .subscribe(this.threadReplySyncObserver(messageId));
    }

    private clearThreadReplyCountSubscriptions(): void {
        Object.values(this.threadReplyCountSubscriptions).forEach((sub: any) =>
            sub.unsubscribe(),
        );
        this.threadReplyCountSubscriptions = {};
    }

    private applyReactionStateToMessageCollections(
        message: Message,
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        message.reactions = clonedReactions;
        this.updateReactionStateLists(messageId, clonedReactions);
        this.updateReactionStateGroups(messageId, clonedReactions);
        this.updateReactionStateThreadParent(messageId, clonedReactions);
    }

    private updateReactionStateLists(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        this.liveMessages = this.replaceMessageReactions(
            this.liveMessages,
            messageId,
            clonedReactions,
        );
        this.olderMessages = this.replaceMessageReactions(
            this.olderMessages,
            messageId,
            clonedReactions,
        );
        this.messages = this.replaceMessageReactions(
            this.messages,
            messageId,
            clonedReactions,
        );
    }

    private updateReactionStateGroups(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        this.messageGroups = this.messageGroups.map((group) => ({
            ...group,
            messages: group.messages.map((groupMessage) =>
                groupMessage.id === messageId
                    ? {
                        ...groupMessage,
                        reactions: this.cloneReactionState(clonedReactions),
                    }
                    : groupMessage,
            ),
        }));
    }

    private updateReactionStateThreadParent(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        if (this.activeThreadParent?.id !== messageId) return;

        this.activeThreadParent = {
            ...this.activeThreadParent,
            reactions: this.cloneReactionState(clonedReactions),
        };
    }

    private canStartThreadReplySync(messageId: string): boolean {
        return (
            !this.threadReplyCountSubscriptions[messageId] &&
            !this.loadingThreadReplyCounts.has(messageId)
        );
    }

    private threadReplySyncObserver(messageId: string) {
        return {
            next: (threadMessages: ThreadMessage[]) =>
                this.onThreadReplySyncSuccess(messageId, threadMessages),
            error: () => this.onThreadReplySyncError(messageId),
        };
    }

    private onThreadReplySyncSuccess(
        messageId: string,
        threadMessages: ThreadMessage[],
    ): void {
        this.threadReplyCountByMessageId[messageId] = threadMessages.length;
        this.loadingThreadReplyCounts.delete(messageId);
    }

    private onThreadReplySyncError(messageId: string): void {
        this.loadingThreadReplyCounts.delete(messageId);
        const sub = this.threadReplyCountSubscriptions[messageId];
        sub?.unsubscribe();
        delete this.threadReplyCountSubscriptions[messageId];
    }

    private getMessageEmojiPickerPlacementKey(
        messageId: string,
        source: 'toolbar' | 'reactions',
    ): string {
        return `${messageId}::${source}`;
    }

    private setMessageEmojiPickerPlacement(
        messageId: string,
        source: 'toolbar' | 'reactions',
        placement: 'above' | 'below',
    ): void {
        const key = this.getMessageEmojiPickerPlacementKey(messageId, source);
        this.messageEmojiPickerPlacement[key] = placement;
    }

    private getMessageEmojiPickerPlacement(
        messageId: string,
        source: 'toolbar' | 'reactions',
    ): 'above' | 'below' {
        const key = this.getMessageEmojiPickerPlacementKey(messageId, source);
        return this.messageEmojiPickerPlacement[key] ?? 'below';
    }

    /**
     * Entscheidet, ob der Picker oberhalb oder unterhalb geöffnet werden soll.
     * Standard ist "unterhalb". Falls unten nicht genug Platz ist, wird oberhalb geöffnet.
     */
    private resolveMessageEmojiPickerPlacement(
        triggerElement: HTMLElement | null,
    ): 'above' | 'below' {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return 'below';
        }

        if (!triggerElement) return 'below';

        const triggerRect = triggerElement.getBoundingClientRect();
        const headerElement = document.querySelector('.home-header') as HTMLElement | null;
        const headerBottom = headerElement?.getBoundingClientRect().bottom ?? 0;
        const viewportTopLimit = headerBottom + this.emojiPickerSafetyOffsetPx;
        const viewportBottomLimit = window.innerHeight - this.emojiPickerSafetyOffsetPx;

        const availableSpaceAbove = triggerRect.top - viewportTopLimit;
        const availableSpaceBelow = viewportBottomLimit - triggerRect.bottom;
        const minimumRequiredSpace =
            this.estimatedEmojiPickerHeightPx + this.emojiPickerSafetyOffsetPx;

        if (availableSpaceBelow >= minimumRequiredSpace) return 'below';
        if (availableSpaceAbove >= minimumRequiredSpace) return 'above';
        return availableSpaceBelow >= availableSpaceAbove ? 'below' : 'above';
    }
}
