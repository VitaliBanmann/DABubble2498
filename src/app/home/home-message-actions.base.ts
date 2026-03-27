import { Injectable } from '@angular/core';
import { ElementRef, QueryList } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, Subscription, take } from 'rxjs';
import { Message, MessageReaction, MessageService, ThreadMessage } from '../services/message.service';
import { HomeSendMessageBase } from './home-send-message.base';

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

    private readonly collapsedReactionLimit = 7;
    private expandedReactionMessages = new Set<string>();
    protected threadSubscription: Subscription | null = null;

    protected abstract editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    protected override resetEditState(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

    protected override resetThreadPanel(): void {
        this.threadSubscription?.unsubscribe();
        this.threadSubscription = null;
        this.activeThreadParent = null;
        this.threadMessages = [];
        this.threadMessageControl.setValue('');
        (this as any).ui?.closeThread?.();
    }

    openThread(): void {
        const first = this.messages[0];
        if (first) this.openThreadForMessage(first);
    }

    openThreadForMessage(message: Message): void {
        if (this.isDirectMessage || !message.id) return;
        this.activeThreadParent = message;
        this.threadMessageControl.setValue('');
        (this as any).ui?.openThread?.();
        this.subscribeToThreadMessages(message.id);
    }

    closeThread(): void { this.resetThreadPanel(); }

    protected subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];
        this.threadSubscription = this.messageService
            .getChannelThreadMessages(parentMessageId)
            .subscribe({
                next: (msgs: ThreadMessage[]) => { this.threadMessages = msgs; },
                error: (e: unknown) => this.handleThreadReadError(e),
            });
    }

    protected handleThreadReadError(error: unknown): void {
        console.error('[THREAD READ ERROR]', error);
        this.errorMessage = 'Thread-Nachrichten konnten nicht geladen werden.';
    }

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

    protected canSendThreadMessage(): boolean {
        return this.canWrite && !this.isDirectMessage && !!this.activeThreadParent?.id;
    }

    protected createThreadMessageRequest(text: string): Observable<string> {
        return this.messageService.sendChannelThreadMessage(
            this.activeThreadParent!.id!, text, this.currentUserId ?? '',
        );
    }

    protected onThreadSendSuccess(): void {
        this.threadMessageControl.setValue('');
        this.isThreadSending = false;
    }

    protected onThreadSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isThreadSending = false;
    }

    onEditMessageClick(message: Message): void {
        if (!this.canEditMessage(message) || !message.id) return;
        this.errorMessage = '';
        this.editingMessageId = message.id;
        this.editMessageControl.setValue((message.text ?? '').trim());
        this.focusActiveEditTextarea();
    }

    canEditMessage(message: Message): boolean {
        return this.isOwnMessage(message) && !!message.id;
    }

    isEditingMessage(message: Message): boolean {
        return !!message.id && this.editingMessageId === message.id;
    }

    cancelMessageEdit(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

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

    protected canSaveMessageEdit(message: Message): boolean {
        return !!message.id && this.isEditingMessage(message) && !this.isSavingEdit;
    }

    protected applyEmptyEditError(): void {
        this.errorMessage = 'Die Nachricht darf nicht leer sein.';
    }

    protected handleSaveEditError(error: unknown): void {
        this.isSavingEdit = false;
        this.errorMessage = this.resolveSendError(error);
    }

    onEditTextareaKeydown(event: KeyboardEvent, message: Message): void {
        if (event.key === 'Escape') { event.preventDefault(); this.cancelMessageEdit(); return; }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault(); this.saveMessageEdit(message);
        }
    }

    protected focusActiveEditTextarea(): void {
        setTimeout(() => {
            const textarea = this.editMessageTextareas?.last?.nativeElement;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 0);
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
        if (this.expandedReactionMessages.has(message.id)) this.expandedReactionMessages.delete(message.id);
        else this.expandedReactionMessages.add(message.id);
    }

    toggleReaction(message: Message, emoji: string): void {
        if (!this.canWrite || !message.id) return;
        this.messageService.toggleReaction({ messageId: message.id, emoji, isDirectMessage: this.isDirectMessage })
            .subscribe({ error: () => { this.errorMessage = 'Reaktion konnte nicht aktualisiert werden.'; } });
    }

    hasCurrentUserReacted(reaction: MessageReaction): boolean {
        if (!this.currentUserId) return false;
        return reaction.userIds.includes(this.currentUserId);
    }

    canOpenThreadFromToolbar(message: Message): boolean {
        return !this.isDirectMessage && !!message.id;
    }

    toggleComposerEmojiPicker(event: MouseEvent): void {
        event.stopPropagation();
        if (this.activeEmojiPicker?.type === 'composer') { this.closeAllEmojiPickers(); return; }
        this.activeEmojiPicker = { type: 'composer' };
    }

    toggleMessageEmojiPicker(message: Message, event: MouseEvent): void {
        event.stopPropagation();
        if (!message.id || !this.canWrite) return;
        if (this.isMessageEmojiPickerOpen(message)) { this.closeAllEmojiPickers(); return; }
        this.activeEmojiPicker = { type: 'message', messageId: message.id };
    }

    isComposerEmojiPickerOpen(): boolean { return this.activeEmojiPicker?.type === 'composer'; }

    isMessageEmojiPickerOpen(message: Message): boolean {
        return !!message.id && this.activeEmojiPicker?.type === 'message' &&
            this.activeEmojiPicker.messageId === message.id;
    }

    closeAllEmojiPickers(): void { this.activeEmojiPicker = null; }
    closeComposerEmojiPicker(): void { this.closeAllEmojiPickers(); }

    onComposerEmojiSelect(event: any): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!emoji || !textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const cur = this.messageControlValue ?? '';
        const next = start + emoji.length;
        this.setMessageControlValue(cur.substring(0, start) + emoji + cur.substring(end));
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = next;
            this.resizeComposerTextarea();
        }, 0);
        this.closeAllEmojiPickers();
    }

    onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) return;
        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

    hasMentionForCurrentUser(message: Message): boolean {
        if (!this.currentUserId) return false;
        return (message.mentions ?? []).includes(this.currentUserId);
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
}
