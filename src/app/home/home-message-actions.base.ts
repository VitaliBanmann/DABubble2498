import { Injectable } from '@angular/core';
import { ElementRef, QueryList } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, Subscription, take } from 'rxjs';
import { Message, MessageReaction, MessageService, ThreadMessage } from '../services/message.service';
import { HomeSendMessageBase } from './home-send-message.base';
import { computeUpdatedReactions } from '../services/message.helpers';

@Injectable()
export abstract class HomeMessageActionsBase extends HomeSendMessageBase {
    readonly editMessageControl = new FormControl('', { nonNullable: true });
    readonly threadMessageControl = new FormControl('', { nonNullable: true });

    editingMessageId: string | null = null;
    isSavingEdit = false;
    isThreadSending = false;
    activeThreadParent: Message | null = null;
    threadMessages: ThreadMessage[] = [];

    activeEmojiPicker:
        | { type: 'composer' }
        | { type: 'message'; messageId: string }
        | null = null;

    readonly defaultToolbarReactionEmojis = ['👍', '✅', '🎉', '❤️'];
    private readonly recentReactionStorageKey = 'dabubble_recent_reaction_emojis';
    private readonly recentReactionLimit = 2;
    private recentReactionEmojis: string[] = this.readRecentReactionEmojis();

    private readonly collapsedReactionLimit = 7;
    private expandedReactionMessages = new Set<string>();
    protected threadSubscription: Subscription | null = null;
    private threadReplyCountByMessageId: Record<string, number> = {};
    private loadingThreadReplyCounts = new Set<string>();
    private threadReplyCountSubscriptions: Record<string, Subscription> = {};

    protected abstract editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    protected abstract triggerViewUpdate(): void;

    /** Handles prepare message stream switch. */
    protected override prepareMessageStreamSwitch(): void {
        this.clearThreadReplyCountSubscriptions();
        this.threadReplyCountByMessageId = {};
        this.loadingThreadReplyCounts.clear();
        super.prepareMessageStreamSwitch();
    }

    /** Handles reset edit state. */
    protected override resetEditState(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

    /** Handles reset thread panel. */
    protected override resetThreadPanel(): void {
        this.threadSubscription?.unsubscribe();
        this.threadSubscription = null;
        this.activeThreadParent = null;
        this.threadMessages = [];
        this.threadMessageControl.setValue('');
        (this as any).ui?.closeThread?.();
    }

    /** Handles open thread. */
    openThread(): void {
        const first = this.messages[0];
        if (first) this.openThreadForMessage(first);
    }

    /** Handles open thread for message. */
    openThreadForMessage(message: Message): void {
        if (this.isDirectMessage || !message.id) return;
        this.activeThreadParent = message;
        (this as any).ui?.setActiveThreadParent?.(message);
        this.threadMessageControl.setValue('');
        (this as any).ui?.setThreadMessages?.([]);
        (this as any).ui?.openThread?.();
        this.subscribeToThreadMessages(message.id);
    }

    /** Handles close thread. */
    closeThread(): void { this.resetThreadPanel(); }

    /** Handles subscribe to thread messages. */
    protected subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];
        (this as any).ui?.setThreadMessages?.([]);
        this.threadSubscription = this.messageService
            .getChannelThreadMessages(parentMessageId)
            .subscribe({
                next: (msgs: ThreadMessage[]) => {
                    this.threadMessages = msgs;
                    (this as any).ui?.setThreadMessages?.(msgs);
                },
                error: (e: unknown) => this.handleThreadReadError(e),
            });
    }

    /** Handles handle thread read error. */
    protected handleThreadReadError(error: unknown): void {
        console.error('[THREAD READ ERROR]', error);
        this.errorMessage = 'Thread-Nachrichten konnten nicht geladen werden.';
    }

    /** Handles send thread message. */
    sendThreadMessage(): void {
        if (!this.canSendThreadMessage()) return;
        const text = this.threadMessageControl.value.trim();
        if (!text) return;
        this.isThreadSending = true;
        this.createThreadMessageRequest(text).subscribe({
            next: () => this.onThreadSendSuccess(),
            error: (e: unknown) => this.onThreadSendError(e),
        });
    }

    /** Handles can send thread message. */
    protected canSendThreadMessage(): boolean {
        return this.canWrite && !this.isDirectMessage && !!this.activeThreadParent?.id;
    }

    /** Handles create thread message request. */
    protected createThreadMessageRequest(text: string): Observable<string> {
        return this.messageService.sendChannelThreadMessage(
            this.activeThreadParent!.id!, text, this.currentUserId ?? '',
        );
    }

    /** Handles on thread send success. */
    protected onThreadSendSuccess(): void {
        this.threadMessageControl.setValue('');
        this.isThreadSending = false;
    }

    /** Handles on thread send error. */
    protected onThreadSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isThreadSending = false;
    }

    /** Handles on edit message click. */
    onEditMessageClick(message: Message): void {
        if (!this.canEditMessage(message) || !message.id) return;
        this.errorMessage = '';
        this.editingMessageId = message.id;
        this.editMessageControl.setValue((message.text ?? '').trim());
        this.focusActiveEditTextarea();
    }

    /** Handles can edit message. */
    canEditMessage(message: Message): boolean {
        return this.isOwnMessage(message) && !!message.id;
    }

    /** Handles is editing message. */
    isEditingMessage(message: Message): boolean {
        return !!message.id && this.editingMessageId === message.id;
    }

    /** Handles cancel message edit. */
    cancelMessageEdit(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

    /** Handles save message edit. */
    saveMessageEdit(message: Message): void {
        if (!this.canSaveMessageEdit(message)) return;
        const nextText = this.editMessageControl.value.trim();
        const currentText = (message.text ?? '').trim();
        if (!nextText) return void this.applyEmptyEditError();
        if (nextText === currentText) return this.cancelMessageEdit();
        this.isSavingEdit = true;
        this.errorMessage = '';
        this.messageService.updateMessage(message.id!, { text: nextText }).subscribe({
            next: () => this.cancelMessageEdit(),
            error: (e: unknown) => this.handleSaveEditError(e),
        });
    }

    /** Handles can save message edit. */
    protected canSaveMessageEdit(message: Message): boolean {
        return !!message.id && this.isEditingMessage(message) && !this.isSavingEdit;
    }

    /** Handles apply empty edit error. */
    protected applyEmptyEditError(): void {
        this.errorMessage = 'Die Nachricht darf nicht leer sein.';
    }

    /** Handles handle save edit error. */
    protected handleSaveEditError(error: unknown): void {
        this.isSavingEdit = false;
        this.errorMessage = this.resolveSendError(error);
    }

    /** Handles on edit textarea keydown. */
    onEditTextareaKeydown(event: KeyboardEvent, message: Message): void {
        if (event.key === 'Escape') { event.preventDefault(); this.cancelMessageEdit(); return; }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault(); this.saveMessageEdit(message);
        }
    }

    /** Handles focus active edit textarea. */
    protected focusActiveEditTextarea(): void {
        setTimeout(() => {
            const textarea = this.editMessageTextareas?.last?.nativeElement;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 0);
    }

    /** Handles is reaction list expanded. */
    isReactionListExpanded(message: Message): boolean {
        return !!message.id && this.expandedReactionMessages.has(message.id);
    }

    /** Handles get visible reactions. */
    getVisibleReactions(message: Message): MessageReaction[] {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return reactions;
        return reactions.slice(0, this.collapsedReactionLimit);
    }

    /** Handles get sorted visible reactions. */
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

    /** Handles get hidden reaction count. */
    getHiddenReactionCount(message: Message): number {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return 0;
        return Math.max(reactions.length - this.collapsedReactionLimit, 0);
    }

    /** Handles toggle reaction list. */
    toggleReactionList(message: Message): void {
        if (!message.id) return;
        if (this.expandedReactionMessages.has(message.id)) this.expandedReactionMessages.delete(message.id);
        else this.expandedReactionMessages.add(message.id);
    }

    /** Handles toggle reaction. */
    /** Handles toggle reaction. */
    toggleReaction(message: Message, emoji: string): void {
        if (!this.canWrite || !message.id || !this.currentUserId) return;

        const previousReactions = this.cloneReactionState(message.reactions ?? []);
        const nextReactions = computeUpdatedReactions(
            message,
            emoji,
            this.currentUserId,
        );

        this.applyOptimisticReactionUpdate(message, nextReactions);
        this.rememberRecentReactionEmoji(emoji);

        this.messageService
            .toggleReaction({
                messageId: message.id,
                emoji,
                isDirectMessage: this.isDirectMessage,
            })
            .subscribe({
                error: () => {
                    this.applyOptimisticReactionUpdate(message, previousReactions);
                    this.errorMessage =
                        'Reaktion konnte nicht aktualisiert werden.';
                },
            });
    }

    /** Applies the updated reactions immediately to all relevant local states. */
    protected applyOptimisticReactionUpdate(
        message: Message,
        reactions: MessageReaction[],
    ): void {
        const messageId = message.id;
        if (!messageId) return;

        const clonedReactions = this.cloneReactionState(reactions);

        message.reactions = clonedReactions;

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

        if (this.activeThreadParent?.id === messageId) {
            this.activeThreadParent = {
                ...this.activeThreadParent,
                reactions: this.cloneReactionState(clonedReactions),
            };
        }

        this.triggerViewUpdate();
    }

    /** Replaces the reactions of a single message inside an array. */
    protected replaceMessageReactions(
        messages: Message[],
        messageId: string,
        reactions: MessageReaction[],
    ): Message[] {
        return messages.map((entry) =>
            entry.id === messageId
                ? {
                    ...entry,
                    reactions: this.cloneReactionState(reactions),
                }
                : entry,
        );
    }

    /** Deep-clones the reaction state for safe local updates. */
    protected cloneReactionState(
        reactions: MessageReaction[],
    ): MessageReaction[] {
        return reactions.map((reaction) => ({
            ...reaction,
            userIds: [...reaction.userIds],
        }));
    }

    /** Applies a local reaction update so the UI changes immediately. */
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
            this.activeThreadParent = {
                ...this.activeThreadParent,
                reactions,
            };
        }

        this.rebuildMessageList();
    }

    /** Returns a new message array with updated reactions for one message. */
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

    /** Handles has current user reacted. */
    hasCurrentUserReacted(reaction: MessageReaction): boolean {
        if (!this.currentUserId) return false;
        return reaction.userIds.includes(this.currentUserId);
    }

    /** Returns the two most recently used reaction emojis. */
    getRecentToolbarReactionEmojis(): string[] {
        return this.recentReactionEmojis.slice(0, this.recentReactionLimit);
    }

    /** Returns all quick reaction emojis shown in the toolbar. */
    getToolbarReactionEmojis(): string[] {
        return Array.from(
            new Set([
                ...this.getRecentToolbarReactionEmojis(),
                ...this.defaultToolbarReactionEmojis,
            ]),
        );
    }

    /** Returns whether an emoji belongs to the recent quick reactions. */
    isRecentToolbarReactionEmoji(emoji: string): boolean {
        return this.getRecentToolbarReactionEmojis().includes(emoji);
    }

    /** Persists a used reaction emoji as a recent quick action. */
    protected rememberRecentReactionEmoji(emoji: string): void {
        const normalized = emoji.trim();
        if (!normalized) return;

        this.recentReactionEmojis = [
            normalized,
            ...this.recentReactionEmojis.filter((item) => item !== normalized),
        ].slice(0, this.recentReactionLimit);

        this.writeRecentReactionEmojis(this.recentReactionEmojis);
    }

    /** Reads recent reaction emojis from local storage. */
    private readRecentReactionEmojis(): string[] {
        if (typeof localStorage === 'undefined') return [];

        try {
            const raw = localStorage.getItem(this.recentReactionStorageKey);
            if (!raw) return [];

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];

            return parsed
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter((item) => !!item)
                .slice(0, this.recentReactionLimit);
        } catch {
            return [];
        }
    }

    /** Writes recent reaction emojis to local storage. */
    private writeRecentReactionEmojis(emojis: string[]): void {
        if (typeof localStorage === 'undefined') return;

        try {
            localStorage.setItem(
                this.recentReactionStorageKey,
                JSON.stringify(emojis),
            );
        } catch {
            // ignore storage errors
        }
    }

    /** Resolves a readable display name for a reaction user. */
    protected getReactionUserDisplayName(userId: string): string {
        if (!userId) return 'Unbekannt';
        if (userId === this.currentUserId) return 'Du';

        const displayName = (this.usersById[userId]?.displayName ?? '').trim();
        return displayName || userId;
    }

    /** Returns all readable user names for a reaction. */
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

    /** Returns accessible tooltip label for a reaction. */
    getReactionTooltipLabel(reaction: MessageReaction): string {
        const names = this.getReactionUserDisplayNames(reaction);
        if (!names.length) return `${reaction.emoji} Reaktion`;

        return `${reaction.emoji} reagiert von ${names.join(', ')}`;
    }

    /** Handles can open thread from toolbar. */
    canOpenThreadFromToolbar(message: Message): boolean {
        return !this.isDirectMessage && !!message.id;
    }

    /** Handles get thread reply count. */
    getThreadReplyCount(message: Message): number {
        const messageId = message.id ?? '';
        if (messageId && messageId in this.threadReplyCountByMessageId) {
            return this.threadReplyCountByMessageId[messageId];
        }

        const countValue = (message.threadReplyCount ?? (message as any).threadCount ?? 0);
        const count = typeof countValue === 'number' ? countValue : Number(countValue);
        const normalized = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

        if (messageId) this.ensureThreadReplyCountSynced(messageId);

        return normalized;
    }

    /** Handles should show thread replies link. */
    shouldShowThreadRepliesLink(message: Message): boolean {
        return this.getThreadReplyCount(message) > 0;
    }

    /** Handles on thread replies click. */
    onThreadRepliesClick(event: MouseEvent, message: Message): void {
        event.preventDefault();
        this.openThreadForMessage(message);
    }

    /** Handles ensure thread reply count synced. */
    private ensureThreadReplyCountSynced(messageId: string): void {
        if (this.threadReplyCountSubscriptions[messageId]) return;
        if (this.loadingThreadReplyCounts.has(messageId)) return;
        this.loadingThreadReplyCounts.add(messageId);

        this.threadReplyCountSubscriptions[messageId] = this.messageService
            .getChannelThreadMessages(messageId)
            .subscribe({
                next: (threadMessages: ThreadMessage[]) => {
                    this.threadReplyCountByMessageId[messageId] = threadMessages.length;
                    this.loadingThreadReplyCounts.delete(messageId);
                },
                error: () => {
                    this.loadingThreadReplyCounts.delete(messageId);
                    const sub = this.threadReplyCountSubscriptions[messageId];
                    sub?.unsubscribe();
                    delete this.threadReplyCountSubscriptions[messageId];
                },
            });
    }

    /** Handles clear thread reply count subscriptions. */
    private clearThreadReplyCountSubscriptions(): void {
        Object.values(this.threadReplyCountSubscriptions).forEach((sub) => sub.unsubscribe());
        this.threadReplyCountSubscriptions = {};
    }

    /** Handles toggle composer emoji picker. */
    toggleComposerEmojiPicker(event: MouseEvent): void {
        event.stopPropagation();
        if (this.activeEmojiPicker?.type === 'composer') { this.closeAllEmojiPickers(); return; }
        this.activeEmojiPicker = { type: 'composer' };
    }

    /** Handles toggle message emoji picker. */
    toggleMessageEmojiPicker(message: Message, event: MouseEvent): void {
        event.stopPropagation();
        if (!message.id || !this.canWrite) return;
        if (this.isMessageEmojiPickerOpen(message)) { this.closeAllEmojiPickers(); return; }
        this.activeEmojiPicker = { type: 'message', messageId: message.id };
    }

    /** Handles is composer emoji picker open. */
    isComposerEmojiPickerOpen(): boolean { return this.activeEmojiPicker?.type === 'composer'; }

    /** Handles is message emoji picker open. */
    isMessageEmojiPickerOpen(message: Message): boolean {
        return !!message.id && this.activeEmojiPicker?.type === 'message' &&
            this.activeEmojiPicker.messageId === message.id;
    }

    /** Handles close all emoji pickers. */
    closeAllEmojiPickers(): void { this.activeEmojiPicker = null; }
    /** Handles close composer emoji picker. */
    closeComposerEmojiPicker(): void { this.closeAllEmojiPickers(); }

    /** Handles on composer emoji select. */
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

    /** Handles insert composer emoji. */
    protected insertComposerEmoji(textarea: HTMLTextAreaElement, emoji: string): number {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = this.messageControlValue ?? '';
        this.setMessageControlValue(value.substring(0, start) + emoji + value.substring(end));
        return start + emoji.length;
    }

    /** Handles on message emoji select. */
    onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) return;
        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

    /** Handles has mention for current user. */
    hasMentionForCurrentUser(message: Message): boolean {
        if (!this.currentUserId) return false;
        return (message.mentions ?? []).includes(this.currentUserId);
    }

    /** Handles is thread parent. */
    isThreadParent(message: Message): boolean {
        return !!message.id && message.id === this.activeThreadParent?.id;
    }

    /** Handles try scroll to message. */
    protected override tryScrollToMessage(): void {
        const msgId = this.pendingScrollToMessageId;
        if (!msgId) return;
        setTimeout(() => this.highlightScrolledMessage(msgId), 400);
    }

    /** Handles highlight scrolled message. */
    protected highlightScrolledMessage(msgId: string): void {
        const el = document.getElementById('msg-' + msgId);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message__line--highlight');
        this.pendingScrollToMessageId = null;
        setTimeout(() => el.classList.remove('message__line--highlight'), 2500);
    }
}
