import { Injectable } from '@angular/core';
import { ElementRef, QueryList } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, Subscription, take } from 'rxjs';
import { Message, MessageReaction, MessageService, ThreadMessage } from '../services/message.service';
import { HomeReactionsBase } from './home-reactions.base';

@Injectable()
export abstract class HomeMessageActionsBase extends HomeReactionsBase {
    readonly editMessageControl = new FormControl('', { nonNullable: true });
    readonly threadMessageControl = new FormControl('', { nonNullable: true });

    editingMessageId: string | null = null;
    isSavingEdit = false;
    isThreadSending = false;
    activeThreadParent: Message | null = null;
    threadMessages: ThreadMessage[] = [];

    protected threadSubscription: Subscription | null = null;

    protected abstract editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    /** Handles prepare message stream switch. */
    protected override prepareMessageStreamSwitch(): void {
        this.resetThreadReplyTracking();
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

}
