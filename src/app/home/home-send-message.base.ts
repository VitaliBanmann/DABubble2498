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
    /** Returns attachment service. */
    protected abstract get attachmentService(): AttachmentService;
    /** Returns is compose mode. */
    protected abstract get isComposeMode(): boolean;

    /** Handles send message. */
    sendMessage(): void {
        if (this.isSending) return;
        if (this.isComposeMode) return void this.sendComposeMessage();
        this.sendPreparedRequest();
    }

    /** Handles can send message. */
    canSendMessage(): boolean {
        return this.canWrite && !this.isSending &&
            (!!this.messageControlValue.trim() || this.selectedAttachments.length > 0);
    }

    /** Handles send compose message. */
    protected async sendComposeMessage(): Promise<void> {
        await this.onComposeTargetSubmit();
        if (!this.composeResolvedTarget) { this.applyComposeSendError(); return; }
        this.sendPreparedRequest();
    }

    /** Handles apply compose send error. */
    protected applyComposeSendError(): void {
        this.errorMessage = 'Bitte zuerst einen gueltigen Empfaenger ueber #channel oder @name auswaehlen.';
    }

    /** Handles send prepared request. */
    protected sendPreparedRequest(): void {
        const request$ = this.prepareSendRequest();
        if (!request$) return;
        this.subscribeToSendRequest(request$);
    }

    /** Handles prepare send request. */
    protected prepareSendRequest(): Observable<string> | null {
        const text = this.messageControlValue.trim();
        if ((!text && !this.selectedAttachments.length) || !this.validateSender()) return null;
        this.prepareSending();
        return this.buildSendRequest(text);
    }

    /** Handles validate sender. */
    protected validateSender(): boolean {
        if (!this.activeAuthUser)
            return this.rejectSender('Du bist nicht angemeldet. Bitte melde dich erneut an.');
        if (this.activeAuthUser.isAnonymous || !this.currentUserId)
            return this.rejectSender('Als Gast kannst du keine Nachrichten senden.');
        return true;
    }

    /** Handles reject sender. */
    protected rejectSender(message: string): boolean {
        this.errorMessage = message;
        return false;
    }

    /** Handles prepare sending. */
    protected prepareSending(): void {
        this.isSending = true;
        this.errorMessage = '';
        this.syncComposerState();
    }

    /** Handles build send request. */
    protected buildSendRequest(text: string): Observable<string> | null {
        try {
            if (this.isComposeMode) return this.buildComposeSendRequest(text);
            if (this.isDirectMessage) return this.buildDirectSendRequest(text);
            return this.buildChannelSendRequest(text);
        } catch (e) { this.onSendError(e); return null; }
    }

    /** Handles build compose send request. */
    protected buildComposeSendRequest(text: string): Observable<string> {
        const target = this.composeResolvedTarget;
        if (!target) throw new Error('Compose target missing');
        return target.kind === 'user'
            ? this.createDirectRequest(text, target.userId)
            : this.buildComposeChannelRequest(text, target.channelId);
    }

    /** Handles build compose channel request. */
    protected buildComposeChannelRequest(text: string, channelId: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const payload = this.createChannelMessagePayload(text, this.collectMentionIdsForText(text), channelId);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments: MessageAttachment[]) =>
                this.messageService.sendMessageWithId(messageId, { ...payload, attachments }),
            ),
        );
    }

    /** Handles build direct send request. */
    protected buildDirectSendRequest(text: string): Observable<string> {
        return this.createDirectRequest(text, this.currentDirectUserId);
    }

    /** Handles create direct request. */
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

    /** Handles build channel send request. */
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

    /** Handles create channel message payload. */
    protected createChannelMessagePayload(text: string, mentions: string[], targetChannelId?: string) {
        return {
            text,
            channelId: targetChannelId || this.currentChannelId || 'allgemein',
            senderId: this.currentUserId ?? '',
            mentions,
            timestamp: new Date(),
        };
    }

    /** Handles subscribe to send request. */
    protected subscribeToSendRequest(request$: Observable<string>): void {
        request$.subscribe({
            next: () => this.onSendSuccess(),
            error: (e: unknown) => this.onSendError(e),
        });
    }

    /** Handles on send success. */
    protected onSendSuccess(): void {
        this.resetComposerAfterSend();
        if (this.isComposeMode) this.resetComposeTarget();
        this.focusAfterSend();
    }

    /** Handles reset composer after send. */
    protected resetComposerAfterSend(): void {
        this.setMessageControlValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();
    }

    /** Handles focus after send. */
    protected focusAfterSend(): void {
        this.resizeComposerTextarea();
        this.focusComposerTextarea();
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

    /** Handles on send error. */
    protected onSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isSending = false;
        this.syncComposerState();
    }

    /** Handles resolve send error. */
    protected resolveSendError(error: unknown): string {
        return error instanceof Error
            ? `Nachricht konnte nicht gesendet werden: ${error.message}`
            : 'Nachricht konnte nicht gesendet werden.';
    }

    /** Handles sync composer state. */
    protected override syncComposerState(): void {
        const control = (this as any).messageControl;
        if (!control) return;
        if (this.isSending && control.enabled) { control.disable({ emitEvent: false }); return; }
        if (!this.isSending && control.disabled) control.enable({ emitEvent: false });
    }

    /** Handles on composer input. */
    onComposerInput(): void {
        this.updateMentionSuggestions();
        this.resizeComposerTextarea();
    }

    /** Handles on composer keydown. */
    onComposerKeydown(event: KeyboardEvent): void {
        if (this.isSending) return;
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (this.canSendMessage()) this.sendMessage();
        }
    }

    /** Handles resize composer textarea. */
    protected resizeComposerTextarea(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;
        textarea.style.height = `${this.composerMinHeightPx}px`;
        this.applyComposerHeight(textarea);
    }

    /** Handles apply composer height. */
    protected applyComposerHeight(textarea: HTMLTextAreaElement): void {
        const next = Math.min(textarea.scrollHeight, this.composerMaxHeightPx);
        textarea.style.height = `${next}px`;
        textarea.style.overflowY = textarea.scrollHeight > this.composerMaxHeightPx ? 'auto' : 'hidden';
    }

    /** Handles focus composer textarea. */
    protected focusComposerTextarea(): void {
        setTimeout(() => this.composerTextareaRef?.nativeElement?.focus(), 0);
    }

    /** Handles on attachment selected. */
    onAttachmentSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (!files.length) return;
        this.attachmentError = '';
        files.forEach((f) => this.addAttachmentIfValid(f));
    }

    /** Handles remove attachment. */
    removeAttachment(index: number): void {
        this.selectedAttachments = this.selectedAttachments.filter((_, i) => i !== index);
    }

    /** Handles add attachment if valid. */
    protected addAttachmentIfValid(file: File): void {
        if (!this.isAllowedAttachmentType(file))
            return this.setAttachmentError('Erlaubt sind Bilder sowie PDF, DOCX und TXT.');
        if (file.size > this.maxAttachmentSizeBytes)
            return this.setAttachmentError('Eine Datei ist zu groß (max. 10 MB pro Datei).');
        this.selectedAttachments = [...this.selectedAttachments, file];
    }

    /** Handles is allowed attachment type. */
    protected isAllowedAttachmentType(file: File): boolean {
        return file.type.startsWith('image/') || this.allowedAttachmentMimeTypes.has(file.type);
    }

    /** Handles set attachment error. */
    protected setAttachmentError(message: string): void { this.attachmentError = message; }

    /** Handles upload attachments for message. */
    protected uploadAttachmentsForMessage(messageId: string): Observable<MessageAttachment[]> {
        if (!this.selectedAttachments.length) return of([]);
        return this.attachmentService.uploadMessageAttachments(messageId, this.selectedAttachments);
    }

    /** Handles insert mention trigger. */
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

    /** Handles reset composer transient state. */
    protected override resetComposerTransientState(): void {
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.pendingOlderScrollRestore = null;
        this.showScrollToLatestButton = false;
    }
}
