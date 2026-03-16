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
import { HomeComponentBase5 } from './home.component.base5';

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
export class HomeComponentBase6 extends HomeComponentBase5 {
    [key: string]: any;

    protected sortMessagesByTimestamp(messages: Message[]): Message[] {
        return [...messages].sort(
            (left, right) =>
                this.toTimestampMillis(left.timestamp) -
                this.toTimestampMillis(right.timestamp),
        );
    }

protected toTimestampMillis(timestamp: Message['timestamp']): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function')
            return timestamp.toMillis();
        if ('toDate' in timestamp && typeof timestamp.toDate === 'function')
            return timestamp.toDate().getTime();
        return 0;
    }

protected markCurrentContextAsRead(): void {
        if (!this.currentUserId || !this.canWrite) return;
        this.createReadMarkRequest()
            .pipe(take(1))
            .subscribe({
                error: (error) => console.error('[READ MARK ERROR]', error),
            });
    }

protected applyDirectSnapshot(userId: string, directUserName: string): void {
        this.isDirectMessage = true;
        this.currentDirectUserId = userId;
        this.currentDirectUserName = directUserName || userId;
    }

protected applyChannelSnapshot(channelId: string): void {
        this.isDirectMessage = false;
        this.currentDirectUserId = '';
        this.currentDirectUserName = '';
        this.currentChannelId = channelId;
    }

protected handleAuthUserChange(incomingUser: FirebaseUser | null): void {
        const stableUser = this.resolveStableAuthUser(incomingUser);
        this.deferUiUpdate(() => this.applyStableAuthUser(stableUser));
    }

protected applyStableAuthUser(stableUser: FirebaseUser | null): void {
        this.authResolved = true;
        this.activeAuthUser = stableUser;
        this.currentUserId = stableUser?.uid ?? null;
        this.canWrite =
            !!stableUser && !stableUser.isAnonymous && !!stableUser.uid;
        this.syncComposerState();
        this.markCurrentContextAsRead();
    }

protected prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
        this.forceScrollToBottomOnNextRender = true;
        this.showScrollToLatestButton = false;
        this.lastRenderedMessageKey = '';
    }

protected createDirectLiveStream(userId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestDirectMessages(
                userId,
                this.pageSize,
            ),
        );
    }

protected createChannelLiveStream(channelId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestChannelMessages(
                channelId,
                this.pageSize,
            ),
        );
    }

protected withRealtimeReconnect(
        stream$: Observable<Message[]>,
    ): Observable<Message[]> {
        return stream$.pipe(
            retry({
                count: 3,
                delay: (error, retryCount) =>
                    this.getReconnectDelay(error, retryCount),
            }),
        );
    }

protected getReconnectDelay(
        error: unknown,
        retryCount: number,
    ): Observable<number> {
        if (!this.isTransientStreamError(error)) {
            return throwError(() => error);
        }

        this.connectionHint =
            'Verbindung instabil. Erneuter Verbindungsversuch...';
        const waitMs = Math.min(500 * 2 ** (retryCount - 1), 3000);
        return timer(waitMs);
    }

protected isTransientStreamError(error: unknown): boolean {
        const code = this.extractFirebaseErrorCode(error);
        return [
            'aborted',
            'cancelled',
            'deadline-exceeded',
            'internal',
            'unavailable',
            'unknown',
        ].includes(code);
    }

protected canLoadOlderMessages(): boolean {
        return !this.isLoadingMoreMessages && this.hasMoreMessages;
    }

protected stopOlderLoading(): void {
        this.hasMoreMessages = false;
    }

protected createOlderLoader(
        timestamp: Message['timestamp'],
    ): Observable<Message[]> {
        return this.isDirectMessage
            ? this.messageService.loadOlderDirectMessages(
                  this.currentDirectUserId,
                  timestamp,
                  this.pageSize,
              )
            : this.messageService.loadOlderChannelMessages(
                  this.currentChannelId,
                  timestamp,
                  this.pageSize,
              );
    }

protected applyOlderMessages(older: Message[]): void {
        const normalized = this.sortMessagesByTimestamp(older);
        this.olderMessages = this.mergeUniqueMessages(
            this.olderMessages,
            normalized,
        );
        this.hasMoreMessages = older.length >= this.pageSize;
        this.isLoadingMoreMessages = false;
        this.rebuildMessageList();
    }

protected handleOlderLoadError(error: unknown): void {
        this.isLoadingMoreMessages = false;
        this.handleRouteMessageError(error);
    }

protected canSendThreadMessage(): boolean {
        return (
            this.canWrite &&
            !this.isDirectMessage &&
            !!this.activeThreadParent?.id
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

protected setAttachmentError(message: string): void {
        this.attachmentError = message;
    }

protected logChannelSendPayload(
        _text: string,
        _mentionsCount: number,
    ): void {}

protected createReadMarkRequest(): Observable<void> {
        return this.isDirectMessage
            ? this.unreadStateService.markDirectAsRead(
                  this.currentUserId!,
                  this.currentDirectUserId,
              )
            : this.unreadStateService.markChannelAsRead(
                  this.currentUserId!,
                  this.currentChannelId,
              );
    }

protected resolveWhenIncomingMissing(
        inAppArea: boolean,
    ): FirebaseUser | null {
        if (this.shouldReuseLastRegularUser(inAppArea))
            return this.lastStableUser;
        this.lastStableUser = null;
        return null;
    }

protected storeAndReturnUser(user: FirebaseUser): FirebaseUser {
        this.lastStableUser = user;
        return user;
    }

protected shouldReuseLastRegularUser(inAppArea: boolean): boolean {
        return !!(
            inAppArea &&
            this.lastStableUser &&
            !this.lastStableUser.isAnonymous
        );
    }

protected rejectSender(message: string): boolean {
        this.errorMessage = message;
        return false;
    }

protected createChannelMessagePayload(
        text: string,
        mentions: string[],
        targetChannelId?: string,
    ) {
        return {
            text,
            channelId: targetChannelId || this.currentChannelId || 'allgemein',
            senderId: this.currentUserId ?? '',
            mentions,
            timestamp: new Date(),
        };
    }

protected tryToDate(timestamp: Message['timestamp']): Date | null {
        if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate();
        }
        return null;
    }

protected formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    protected formatDateAndTime(timestamp: Message['timestamp']): string {
        const date = this.tryToDate(timestamp);
        return date ? `${this.getDateSeparatorLabel(date)} ${this.formatTime(date)}` : '';
    }

protected resolveTrackTimestamp(
        timestamp: Message['timestamp'],
        fallback: number,
    ): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function')
            return timestamp.toMillis();
        return fallback;
    }

protected applyFetchedDirectUserName(
        user: User | null,
        preferredName: string,
    ): void {
        this.currentDirectUserName =
            user?.displayName ?? preferredName ?? this.currentDirectUserId;
    }

protected applyDirectUserFallbackName(preferredName: string): void {
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
    }
}
