import { Directive } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    ThreadMessage,
} from '../services/message.service';
import { MentionCandidate } from './home.component.models';
import { HomeComponentBase3 } from './home.component.base3';

@Directive()
export class HomeComponentBase4 extends HomeComponentBase3 {
    [key: string]: any;

    protected buildComposeSendRequest(text: string): Observable<string> {
        const target = this.composeResolvedTarget;
        if (!target) throw new Error('Compose target missing');
        return target.kind === 'user'
            ? this.buildComposeDirectRequest(text, target.userId)
            : this.buildComposeChannelRequest(text, target.channelId);
    }

    protected buildComposeDirectRequest(text: string, userId: string): Observable<string> {
        return this.createDirectRequest(text, userId);
    }

    protected buildComposeChannelRequest(text: string, channelId: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const payload = this.createChannelMessagePayload(text, this.collectMentionIdsForText(text), channelId);
        return this.uploadAttachmentsForMessage(messageId).pipe(switchMap((attachments: MessageAttachment[]): Observable<string> => this.messageService.sendMessageWithId(messageId, { ...payload, attachments })));
    }

protected buildDirectSendRequest(text: string): Observable<string> {
        return this.createDirectRequest(text, this.currentDirectUserId);
    }

    protected createDirectRequest(text: string, userId: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        return this.uploadAttachmentsForMessage(messageId).pipe(switchMap((attachments: MessageAttachment[]): Observable<string> => this.messageService.sendDirectMessageWithId(messageId, userId, text, this.currentUserId ?? '', mentions, attachments)));
    }

protected buildChannelSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        this.logChannelSendPayload(text, mentions.length);
        const channelPayload = this.createChannelMessagePayload(text, mentions);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments: MessageAttachment[]): Observable<string> =>
                this.messageService.sendMessageWithId(messageId, {
                    ...channelPayload,
                    attachments,
                }),
            ),
        );
    }

protected uploadAttachmentsForMessage(
        messageId: string,
    ): Observable<MessageAttachment[]> {
        if (!this.selectedAttachments.length) {
            return of([]);
        }

        return this.attachmentService.uploadMessageAttachments(
            messageId,
            this.selectedAttachments,
        );
    }

protected onSendSuccess(): void {
        this.resetComposerAfterSend();
        if (this.isComposeMode) this.resetComposeTarget();
        this.focusAfterSend();
    }

    protected resetComposerAfterSend(): void {
        this.messageControl.setValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();
    }

    protected resetComposeTarget(): void {
        this.ui.closeNewMessage();
        this.composeTargetControl.setValue('');
        this.composeResolvedTarget = null;
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

get currentChannelName(): string {
        return (
            this.channelNames[this.currentChannelId] ?? this.currentChannelId
        );
    }

get currentConversationTitle(): string {
        if (this.isDirectMessage) {
            const directUser = this.usersById[this.currentDirectUserId];
            return (
                directUser?.displayName ||
                this.currentDirectUserName ||
                this.currentDirectUserId
            );
        }

        return this.currentChannelName;
    }

get latestMessageSummary(): string {
        const latest = this.messages[this.messages.length - 1];
        if (!latest) {
            return '';
        }

        const stamp = this.formatDateAndTime(latest.timestamp);
        const sender = this.getSenderLabel(latest);
        const text = (latest.text ?? '').trim();
        const preview = text ? text : '(nur Anhang)';
        return `${sender}: ${preview} (${stamp})`;
    }

get isThreadPanelOpen(): boolean {
        return this.ui.isThreadOpen();
    }

get activeThreadTitle(): string {
        if (!this.activeThreadParent) {
            return 'Thread';
        }

        return this.activeThreadParent.text;
    }

formatTimestamp(timestamp: Message['timestamp']): string {
        if (!timestamp) return '';
        const date =
            timestamp instanceof Date ? timestamp : this.tryToDate(timestamp);
        return date ? this.formatTime(date) : '';
    }

isOwnMessage(message: Message): boolean {
        return !!this.currentUserId && message.senderId === this.currentUserId;
    }

getSenderLabel(message: Message): string {
        if (this.isOwnMessage(message)) {
            return 'Du';
        }

        return (
            this.usersById[message.senderId]?.displayName ?? message.senderId
        );
    }

getMessageAvatar(message: Message): string {
        const fallbackAvatar = 'assets/pictures/profile.svg';
        const user = this.usersById[message.senderId];
        const rawAvatar = (user?.avatar ?? '').trim();

        if (!rawAvatar) {
            return fallbackAvatar;
        }

        return this.normalizeAvatarPath(rawAvatar, fallbackAvatar);
    }

protected normalizeAvatarPath(
        avatar: string,
        fallbackAvatar: string,
    ): string {
        const trimmed = avatar.trim();
        if (!trimmed) return fallbackAvatar;
        if (this.isExternalAvatar(trimmed) || this.isAssetAvatar(trimmed)) return trimmed;
        return `assets/pictures/${trimmed}`;
    }

    protected isExternalAvatar(value: string): boolean {
        return ['http://', 'https://', 'data:', 'blob:'].some((prefix) => value.startsWith(prefix));
    }

    protected isAssetAvatar(value: string): boolean {
        return value.startsWith('/assets/') || value.startsWith('assets/');
    }

hasMentionForCurrentUser(message: Message): boolean {
        if (!this.currentUserId) {
            return false;
        }

        return (message.mentions ?? []).includes(this.currentUserId);
    }

selectMention(candidate: MentionCandidate): void {
        const value = this.messageControl.value;
        const mentionStart = value.lastIndexOf('@');
        if (mentionStart < 0) return;
        const before = value.slice(0, mentionStart);
        const mentionToken = `@${candidate.label} `;
        this.messageControl.setValue(`${before}${mentionToken}`);
        this.selectedMentions.set(candidate.id, candidate);
        this.hideMentionSuggestions();
    }

removeMention(candidateId: string): void {
        this.selectedMentions.delete(candidateId);
    }

selectedMentionsList(): MentionCandidate[] {
        return Array.from(this.selectedMentions.values());
    }

trackMessage(index: number, message: Message): string {
        if (message.id) return message.id;
        const timestamp = this.resolveTrackTimestamp(message.timestamp, index);
        return `${message.senderId}-${timestamp}-${message.text}`;
    }

trackThreadMessage(index: number, message: ThreadMessage): string {
        if (message.id) {
            return message.id;
        }

        return this.trackMessage(index, message as Message);
    }

isThreadParent(message: Message): boolean {
        return !!message.id && message.id === this.activeThreadParent?.id;
    }

getVisibleReactions(message: Message): MessageReaction[] {
        const reactions = message.reactions ?? [];
        if (!message.id || this.expandedReactionMessages.has(message.id)) {
            return reactions;
        }

        return reactions.slice(0, 20);
    }
}
