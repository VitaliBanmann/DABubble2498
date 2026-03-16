import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    Directive,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    QueryList,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
    combineLatest,
    of,
    Observable,
    retry,
    Subscription,
    switchMap,
    take,
    throwError,
    timer,
} from 'rxjs';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    MessageService,
    ThreadMessage,
} from '../services/message.service';
import { AttachmentService } from '../services/attachment.service';
import { UiStateService } from '../services/ui-state.service';
import { UnreadStateService } from '../services/unread-state.service';
import { User, UserService } from '../services/user.service';
import { User as FirebaseUser } from 'firebase/auth';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { HomeComponentBase3 } from './home.component.base3';

interface MentionCandidate {
    id: string;
    label: string;
}

interface ComposeTargetSuggestion {
    kind: 'channel' | 'user';
    id: string;
    label: string;
    value: string;
    subtitle: string;
}

interface MessageGroup {
    id: string;
    senderId: string;
    isOwn: boolean;
    startedAt: Message['timestamp'];
    messages: Message[];
}

@Directive()
export class HomeComponentBase4 extends HomeComponentBase3 {
    [key: string]: any;

    protected buildComposeSendRequest(text: string): Observable<string> {
        const target = this.composeResolvedTarget;
        if (!target) {
            throw new Error('Compose target missing');
        }

        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);

        if (target.kind === 'user') {
            return this.uploadAttachmentsForMessage(messageId).pipe(
                switchMap((attachments) =>
                    this.messageService.sendDirectMessageWithId(
                        messageId,
                        target.userId,
                        text,
                        this.currentUserId ?? '',
                        mentions,
                        attachments,
                    ),
                ),
            );
        }

        const payload = this.createChannelMessagePayload(
            text,
            mentions,
            target.channelId,
        );

        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments) =>
                this.messageService.sendMessageWithId(messageId, {
                    ...payload,
                    attachments,
                }),
            ),
        );
    }

protected buildDirectSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments) =>
                this.messageService.sendDirectMessageWithId(
                    messageId,
                    this.currentDirectUserId,
                    text,
                    this.currentUserId ?? '',
                    mentions,
                    attachments,
                ),
            ),
        );
    }

protected buildChannelSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        this.logChannelSendPayload(text, mentions.length);
        const channelPayload = this.createChannelMessagePayload(text, mentions);
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments) =>
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
        console.log('[SEND SUCCESS]');
        this.messageControl.setValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();

        if (this.isComposeMode) {
            this.ui.closeNewMessage();
            this.composeTargetControl.setValue('');
            this.composeResolvedTarget = null;
        }

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

        if (!trimmed) {
            return fallbackAvatar;
        }

        if (
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('blob:')
        ) {
            return trimmed;
        }

        if (trimmed.startsWith('/assets/')) {
            return trimmed;
        }

        if (trimmed.startsWith('assets/')) {
            return trimmed;
        }

        return `assets/pictures/${trimmed}`;
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
