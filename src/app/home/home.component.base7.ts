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
import { HomeComponentBase6 } from './home.component.base6';

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
export class HomeComponentBase7 extends HomeComponentBase6 {
    [key: string]: any;

    protected resetThreadPanel(): void {
        this.threadSubscription?.unsubscribe();
        this.threadSubscription = null;
        this.activeThreadParent = null;
        this.threadMessages = [];
        this.threadMessageControl.setValue('');
        this.ui.closeThread();
    }

protected toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return this.asValidDate(value);
        if (this.hasToDate(value)) return this.asValidDate(value.toDate());
        if (typeof value === 'number' || typeof value === 'string') return this.asValidDate(new Date(value));
        return null;
    }

    protected hasToDate(value: unknown): value is { toDate: () => Date } {
        return typeof value === 'object' && !!value && 'toDate' in value && typeof value.toDate === 'function';
    }

    protected asValidDate(value: Date): Date | null {
        return isNaN(value.getTime()) ? null : value;
    }

protected isSameCalendarDay(a: Date | null, b: Date | null): boolean {
        if (!a || !b) return false;

        return (
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate()
        );
    }

protected isWithinMessageGroupWindow(
        currentTimestamp: Message['timestamp'],
        previousTimestamp: Message['timestamp'],
    ): boolean {
        const currentDate = this.toDate(currentTimestamp);
        const previousDate = this.toDate(previousTimestamp);

        if (!currentDate || !previousDate) {
            return false;
        }

        const diffMs = currentDate.getTime() - previousDate.getTime();
        return diffMs >= 0 && diffMs <= this.messageGroupWindowMs;
    }

shouldShowGroupDateSeparator(index: number, group: MessageGroup): boolean {
        if (index === 0) {
            return true;
        }

        const currentDate = this.toDate(group.startedAt);
        const previousDate = this.toDate(
            this.messageGroups[index - 1]?.startedAt,
        );

        return !this.isSameCalendarDay(currentDate, previousDate);
    }

getDateSeparatorLabel(timestamp: unknown): string {
        const date = this.toDate(timestamp);
        if (!date) return '';
        if (this.isSameCalendarDay(date, new Date())) return 'Heute';
        if (this.isSameCalendarDay(date, this.getYesterday())) return 'Gestern';
        return this.formatCalendarDate(date);
    }

    protected getYesterday(): Date {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
    }

    protected formatCalendarDate(date: Date): string {
        return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    }

onComposerKeydown(event: KeyboardEvent): void {
        if (this.isSending) {
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();

            if (this.canSendMessage()) {
                this.sendMessage();
            }
        }
    }

toggleComposerEmojiPicker(event: MouseEvent): void {
        event.stopPropagation();

        if (this.activeEmojiPicker?.type === 'composer') {
            this.closeAllEmojiPickers();
            return;
        }

        this.activeEmojiPicker = { type: 'composer' };
    }

toggleMessageEmojiPicker(message: Message, event: MouseEvent): void {
        event.stopPropagation();
        if (!message.id || !this.canWrite) return;
        if (this.isMessageEmojiPickerOpen(message)) return this.closeAllEmojiPickers();
        this.activeEmojiPicker = { type: 'message', messageId: message.id };
    }

isComposerEmojiPickerOpen(): boolean {
        return this.activeEmojiPicker?.type === 'composer';
    }

isMessageEmojiPickerOpen(message: Message): boolean {
        return (
            !!message.id &&
            this.activeEmojiPicker?.type === 'message' &&
            this.activeEmojiPicker.messageId === message.id
        );
    }

closeAllEmojiPickers(): void {
        this.activeEmojiPicker = null;
    }

closeComposerEmojiPicker(): void {
        this.closeAllEmojiPickers();
    }

@HostListener('document:click')
    onDocumentClick(): void {
        this.closeAllEmojiPickers();
    }

@HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: Event): void {
        if (!this.activeEmojiPicker) {
            return;
        }

        event.preventDefault();
        this.closeAllEmojiPickers();
    }

onComposerEmojiSelect(event: any): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!emoji || !textarea) return;
        const nextCursor = this.insertComposerText(textarea, emoji);
        this.restoreComposerSelection(textarea, nextCursor);
        this.closeAllEmojiPickers();
    }

    protected insertComposerText(textarea: HTMLTextAreaElement, value: string): number {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentValue = this.messageControl.value ?? '';
        this.messageControl.setValue(currentValue.substring(0, start) + value + currentValue.substring(end));
        return start + value.length;
    }

    protected restoreComposerSelection(textarea: HTMLTextAreaElement, nextCursor: number): void {
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = nextCursor;
            this.resizeComposerTextarea();
        }, 0);
    }

onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) {
            return;
        }

        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

insertMentionTrigger(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;
        const nextCursor = this.insertComposerText(textarea, '@');
        this.restoreMentionSelection(textarea, nextCursor);
    }

    protected restoreMentionSelection(textarea: HTMLTextAreaElement, nextCursor: number): void {
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = nextCursor;
            this.onComposerInput();
        }, 0);
    }
}
