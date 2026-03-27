import { Injectable } from '@angular/core';
import { ElementRef } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { AttachmentService } from '../services/attachment.service';
import { Message, MessageAttachment } from '../services/message.service';
import { HomeComposeTargetBase } from './home-compose-target.base';

@Injectable()
export abstract class HomeSendMessageBase extends HomeComposeTargetBase {
    isSending = false;
    selectedAttachments: File[] = [];
    attachmentError = '';

    protected readonly composerMinHeightPx = 145;
    protected readonly composerMaxHeightPx = 180;
    protected readonly maxAttachmentSizeBytes = 10 * 1024 * 1024;
    protected readonly allowedAttachmentMimeTypes = new Set<string>([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
    ]);

    protected abstract composerTextareaRef?: ElementRef<HTMLTextAreaElement>;
    protected abstract get attachmentService(): AttachmentService;
    protected abstract get isComposeMode(): boolean;

    sendMessage(): void {
        if (this.isSending) return;
        if (this.isComposeMode) return void this.sendComposeMessage();
        this.sendPreparedRequest();
    }

    canSendMessage(): boolean {
        return this.canWrite && !this.isSending &&
            (!!this.messageControlValue.trim() || this.selectedAttachments.length > 0);
    }

    protected async sendComposeMessage(): Promise<void> {
        await this.onComposeTargetSubmit();
        if (!this.composeResolvedTarget) { this.applyComposeSendError(); return; }
        this.sendPreparedRequest();
    }

    protected applyComposeSendError(): void {
        this.errorMessage = 'Bitte zuerst einen gueltigen Empfaenger ueber #channel oder @name auswaehlen.';
    }

    protected sendPreparedRequest(): void {
        const request$ = this.prepareSendRequest();
        if (!request$) return;
        this.subscribeToSendRequest(request$);
    }

    protected prepareSendRequest(): Observable<string> | null {
        const text = this.messageControlValue.trim();
        if ((!text && !this.selectedAttachments.length) || !this.validateSender()) return null;
        this.prepareSending();
        return this.buildSendRequest(text);
    }

    protected validateSender(): boolean {
        if (!this.activeAuthUser)
            return this.rejectSender('Du bist nicht angemeldet. Bitte melde dich erneut an.');
        if (this.activeAuthUser.isAnonymous || !this.currentUserId)
            return this.rejectSender('Als Gast kannst du keine Nachrichten senden.');
        return true;
    }

    protected rejectSender(message: string): boolean {
        this.errorMessage = message;
        return false;
    }

    protected prepareSending(): void {
        this.isSending = true;
        this.errorMessage = '';
        this.syncComposerState();
    }

    protected buildSendRequest(text: string): Observable<string> | null {
        try {
            if (this.isComposeMode) return this.buildComposeSendRequest(text);
            if (this.isDirectMessage) return this.buildDirectSendRequest(text);
            return this.buildChannelSendRequest(text);
        } catch (e) { this.onSendError(e); return null; }
    }

    protected buildComposeSendRequest(text: string): Observable<string> {
        const target = this.composeResolvedTarget;
        if (!target) throw new Error('Compose target missing');
        return target.kind === 'user'
            ? this.createDirectRequest(text, target.userId)
            : this.buildComposeChannelRequest(text, target.channelId);
    }

    protected buildComposeChannelRequest(text: string, channelId: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const payload = this.createChannelMessagePayload(text, this.collectMentionIdsForText(text), channelId);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments: MessageAttachment[]) =>
                this.messageService.sendMessageWithId(messageId, { ...payload, attachments }),
            ),
        );
    }

    protected buildDirectSendRequest(text: string): Observable<string> {
        return this.createDirectRequest(text, this.currentDirectUserId);
    }

    protected createDirectRequest(text: string, userId: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments: MessageAttachment[]) =>
                this.messageService.sendDirectMessageWithId(
                    messageId, userId, text, this.currentUserId ?? '', mentions, attachments,
                ),
            ),
        );
    }

    protected buildChannelSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        const payload = this.createChannelMessagePayload(text, mentions);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments: MessageAttachment[]) =>
                this.messageService.sendMessageWithId(messageId, { ...payload, attachments }),
            ),
        );
    }

    protected createChannelMessagePayload(text: string, mentions: string[], targetChannelId?: string) {
        return {
            text,
            channelId: targetChannelId || this.currentChannelId || 'allgemein',
            senderId: this.currentUserId ?? '',
            mentions,
            timestamp: new Date(),
        };
    }

    protected subscribeToSendRequest(request$: Observable<string>): void {
        request$.subscribe({
            next: () => this.onSendSuccess(),
            error: (e: unknown) => this.onSendError(e),
        });
    }

    protected onSendSuccess(): void {
        this.resetComposerAfterSend();
        if (this.isComposeMode) this.resetComposeTarget();
        this.focusAfterSend();
    }

    protected resetComposerAfterSend(): void {
        this.setMessageControlValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();
    }

    protected focusAfterSend(): void {
        this.resizeComposerTextarea();
        this.focusComposerTextarea();
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

    protected onSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isSending = false;
        this.syncComposerState();
    }

    protected resolveSendError(error: unknown): string {
        return error instanceof Error
            ? `Nachricht konnte nicht gesendet werden: ${error.message}`
            : 'Nachricht konnte nicht gesendet werden.';
    }

    protected override syncComposerState(): void {
        const control = (this as any).messageControl;
        if (!control) return;
        if (this.isSending && control.enabled) { control.disable({ emitEvent: false }); return; }
        if (!this.isSending && control.disabled) control.enable({ emitEvent: false });
    }

    onComposerInput(): void {
        this.updateMentionSuggestions();
        this.resizeComposerTextarea();
    }

    onComposerKeydown(event: KeyboardEvent): void {
        if (this.isSending) return;
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (this.canSendMessage()) this.sendMessage();
        }
    }

    protected resizeComposerTextarea(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;
        textarea.style.height = `${this.composerMinHeightPx}px`;
        this.applyComposerHeight(textarea);
    }

    protected applyComposerHeight(textarea: HTMLTextAreaElement): void {
        const next = Math.min(textarea.scrollHeight, this.composerMaxHeightPx);
        textarea.style.height = `${next}px`;
        textarea.style.overflowY = textarea.scrollHeight > this.composerMaxHeightPx ? 'auto' : 'hidden';
    }

    protected focusComposerTextarea(): void {
        setTimeout(() => this.composerTextareaRef?.nativeElement?.focus(), 0);
    }

    onAttachmentSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (!files.length) return;
        this.attachmentError = '';
        files.forEach((f) => this.addAttachmentIfValid(f));
    }

    removeAttachment(index: number): void {
        this.selectedAttachments = this.selectedAttachments.filter((_, i) => i !== index);
    }

    protected addAttachmentIfValid(file: File): void {
        if (!this.isAllowedAttachmentType(file))
            return this.setAttachmentError('Erlaubt sind Bilder sowie PDF, DOCX und TXT.');
        if (file.size > this.maxAttachmentSizeBytes)
            return this.setAttachmentError('Eine Datei ist zu groß (max. 10 MB pro Datei).');
        this.selectedAttachments = [...this.selectedAttachments, file];
    }

    protected isAllowedAttachmentType(file: File): boolean {
        return file.type.startsWith('image/') || this.allowedAttachmentMimeTypes.has(file.type);
    }

    protected setAttachmentError(message: string): void { this.attachmentError = message; }

    protected uploadAttachmentsForMessage(messageId: string): Observable<MessageAttachment[]> {
        if (!this.selectedAttachments.length) return of([]);
        return this.attachmentService.uploadMessageAttachments(messageId, this.selectedAttachments);
    }

    insertMentionTrigger(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const cur = this.messageControlValue ?? '';
        this.setMessageControlValue(cur.substring(0, start) + '@' + cur.substring(end));
        const next = start + 1;
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = next;
            this.onComposerInput();
        }, 0);
    }

    protected override resetComposerTransientState(): void {
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.pendingOlderScrollRestore = null;
        this.showScrollToLatestButton = false;
    }
}
