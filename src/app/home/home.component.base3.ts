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
import { HomeComponentBase2 } from './home.component.base2';

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
export class HomeComponentBase3 extends HomeComponentBase2 {
    [key: string]: any;

    protected shouldStartNewGroup(
        currentGroup: MessageGroup,
        nextMessage: Message,
    ): boolean {
        const previousMessage =
            currentGroup.messages[currentGroup.messages.length - 1];
        if (!previousMessage) {
            return true;
        }

        if (currentGroup.senderId !== nextMessage.senderId) {
            return true;
        }

        const previousDate = this.toDate(previousMessage.timestamp);
        const nextDate = this.toDate(nextMessage.timestamp);

        if (!this.isSameCalendarDay(previousDate, nextDate)) {
            return true;
        }

        return !this.isWithinMessageGroupWindow(
            nextMessage.timestamp,
            previousMessage.timestamp,
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

protected clearMessagesState(): void {
        this.resetMessageStreams();
        this.messages = [];
    }

ngOnDestroy(): void {
        this.threadSubscription?.unsubscribe();
        this.liveMessagesSubscription?.unsubscribe();
        this.subscription.unsubscribe();
    }

openThread(): void {
        const firstMessage = this.messages[0];
        if (!firstMessage) {
            return;
        }

        this.openThreadForMessage(firstMessage);
    }

closeThread(): void {
        this.resetThreadPanel();
    }

loadOlderMessages(): void {
        if (!this.canLoadOlderMessages()) return;

        const oldestLoaded = this.messages[0];
        if (!oldestLoaded?.timestamp) return this.stopOlderLoading();

        const container = this.getMessageListElement();
        if (container) {
            this.pendingOlderScrollRestore = {
                previousScrollTop: container.scrollTop,
                previousScrollHeight: container.scrollHeight,
            };
        }

        this.isLoadingMoreMessages = true;

        this.createOlderLoader(oldestLoaded.timestamp).subscribe({
            next: (older) => this.applyOlderMessages(older),
            error: (error) => this.handleOlderLoadError(error),
        });
    }

openThreadForMessage(message: Message): void {
        if (this.isDirectMessage || !message.id) {
            return;
        }

        this.activeThreadParent = message;
        this.threadMessageControl.setValue('');
        this.ui.openThread();
        this.subscribeToThreadMessages(message.id);
    }

sendThreadMessage(): void {
        if (!this.canSendThreadMessage()) return;
        const text = this.threadMessageControl.value.trim();
        if (!text) return;
        this.isThreadSending = true;
        this.messageService
            .sendChannelThreadMessage(
                this.activeThreadParent!.id!,
                text,
                this.currentUserId ?? '',
            )
            .subscribe({
                next: () => this.onThreadSendSuccess(),
                error: (error) => this.onThreadSendError(error),
            });
    }

async logout(): Promise<void> {
        await this.authFlow.logoutToLogin();
    }

sendMessage(): void {
        if (this.isSending) {
            return;
        }

        if (this.isComposeMode) {
            void this.onComposeTargetSubmit().then(() => {
                if (!this.composeResolvedTarget) {
                    this.errorMessage =
                        'Bitte zuerst einen gueltigen Empfaenger ueber #channel oder @name auswaehlen.';
                    return;
                }

                const request$ = this.prepareSendRequest();
                if (!request$) return;
                this.subscribeToSendRequest(request$);
            });
            return;
        }
        const request$ = this.prepareSendRequest();
        if (!request$) {
            return;
        }
        this.subscribeToSendRequest(request$);
    }

protected prepareSendRequest(): Observable<string> | null {
        const text = this.readMessageText();
        if (
            (!text && !this.selectedAttachments.length) ||
            !this.validateSender()
        ) {
            return null;
        }

        this.prepareSending();
        return this.buildSendRequest(text);
    }

protected readMessageText(): string {
        return this.messageControl.value.trim();
    }

onAttachmentSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';

        if (!files.length) {
            return;
        }

        this.attachmentError = '';
        files.forEach((file) => this.addAttachmentIfValid(file));
    }

removeAttachment(index: number): void {
        this.selectedAttachments = this.selectedAttachments.filter(
            (_file, currentIndex) => currentIndex !== index,
        );
    }

canSendMessage(): boolean {
        const hasText = !!this.messageControl.value.trim();
        const hasAttachments = this.selectedAttachments.length > 0;
        return this.canWrite && !this.isSending && (hasText || hasAttachments);
    }

protected addAttachmentIfValid(file: File): void {
        if (!this.isAllowedAttachmentType(file))
            return this.setAttachmentError(
                'Erlaubt sind Bilder sowie PDF, DOCX und TXT.',
            );
        if (file.size > this.maxAttachmentSizeBytes)
            return this.setAttachmentError(
                'Eine Datei ist zu groÃŸ (max. 10 MB pro Datei).',
            );
        this.selectedAttachments = [...this.selectedAttachments, file];
    }

protected isAllowedAttachmentType(file: File): boolean {
        if (file.type.startsWith('image/')) {
            return true;
        }

        return this.allowedAttachmentMimeTypes.has(file.type);
    }

onComposerInput(): void {
        this.updateMentionSuggestions();
        this.resizeComposerTextarea();
    }

protected resizeComposerTextarea(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) {
            return;
        }

        textarea.style.height = `${this.composerMinHeightPx}px`;
        const nextHeight = Math.min(textarea.scrollHeight, this.composerMaxHeightPx);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY =
            textarea.scrollHeight > this.composerMaxHeightPx ? 'auto' : 'hidden';
    }

protected focusComposerTextarea(): void {
        setTimeout(() => {
            const textarea = this.composerTextareaRef?.nativeElement;
            if (!textarea) {
                return;
            }

            textarea.focus();
        }, 0);
    }

protected subscribeToSendRequest(request$: Observable<string>): void {
        request$.subscribe({
            next: () => this.onSendSuccess(),
            error: (error) => this.onSendError(error),
        });
    }

protected validateSender(): boolean {
        if (!this.activeAuthUser)
            return this.rejectSender(
                'Du bist nicht angemeldet. Bitte melde dich erneut an.',
            );
        if (this.activeAuthUser.isAnonymous || !this.currentUserId) {
            return this.rejectSender(
                'Als Gast kannst du keine Nachrichten senden.',
            );
        }
        return true;
    }

protected prepareSending(): void {
        this.isSending = true;
        this.errorMessage = '';
        this.syncComposerState();
    }

protected buildSendRequest(text: string): Observable<string> | null {
        try {
            if (this.isComposeMode) {
                return this.buildComposeSendRequest(text);
            }

            if (this.isDirectMessage) {
                return this.buildDirectSendRequest(text);
            }

            return this.buildChannelSendRequest(text);
        } catch (error) {
            this.onSendError(error);
            return null;
        }
    }
}
