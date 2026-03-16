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
import { HomeComponentBase1 } from './home.component.base1';

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
export class HomeComponentBase2 extends HomeComponentBase1 {
    [key: string]: any;

    protected loadMessagesForRoute(params: ParamMap): void {
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        this.errorMessage = '';

        if (directUserId) {
            this.setupDirectMessages(directUserId, directUserName);
            return;
        }

        this.setupChannelMessages(params);
    }

async onComposeTargetSubmit(): Promise<void> {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) {
            this.errorMessage =
                'Bitte gib ein Ziel ein (#channel, @user oder E-Mail).';
            this.composeResolvedTarget = null;
            return;
        }

        this.hideComposeTargetSuggestions();

        const channelId = this.resolveChannelTarget(raw);
        if (channelId) {
            this.composeResolvedTarget = { kind: 'channel', channelId };
            this.errorMessage = '';
            return;
        }

        const user = this.resolveDirectTarget(raw);
        if (user?.id) {
            if (user.id === this.currentUserId) {
                this.errorMessage =
                    'Direktnachricht an dich selbst ist nicht noetig.';
                this.composeResolvedTarget = null;
                return;
            }

            this.composeResolvedTarget = { kind: 'user', userId: user.id };
            this.errorMessage = '';
            return;
        }

        this.errorMessage =
            'Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.';
        this.composeResolvedTarget = null;
    }

protected resolveChannelTarget(input: string): string | null {
        const token = input.replace(/^#/, '').trim().toLowerCase();
        if (!token) return null;

        const channelById = Object.keys(this.channelNames).find(
            (id) => id.toLowerCase() === token,
        );
        if (channelById) return channelById;

        const channelByLabel = Object.entries(this.channelNames).find(
            ([, label]) => label.toLowerCase() === token,
        );
        return channelByLabel?.[0] ?? null;
    }

protected resolveDirectTarget(input: string): User | null {
        const token = input.replace(/^@/, '').trim().toLowerCase();
        if (!token) return null;

        const allUsers = Object.values(this.usersById);

        const byEmail = allUsers.find(
            (u) => (u.email ?? '').trim().toLowerCase() === token,
        );
        if (byEmail) return byEmail;

        const byExactName = allUsers.find(
            (u) => (u.displayName ?? '').trim().toLowerCase() === token,
        );
        if (byExactName) return byExactName;

        const byPartialName = allUsers.find((u) =>
            (u.displayName ?? '').trim().toLowerCase().includes(token),
        );
        return byPartialName ?? null;
    }

protected setupDirectMessages(userId: string, name: string): void {
        this.applyDirectSnapshot(userId, name);
        this.prepareMessageStreamSwitch();
        this.liveMessagesSubscription = this.createDirectLiveStream(
            userId,
        ).subscribe({
            next: (messages) => this.applyLiveMessages(messages),
            error: (error) => this.handleRouteMessageError(error),
        });
        this.markCurrentContextAsRead();
    }

protected setupChannelMessages(params: ParamMap): void {
        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
        this.prepareMessageStreamSwitch();
        this.liveMessagesSubscription = this.createChannelLiveStream(
            this.currentChannelId,
        ).subscribe({
            next: (messages) => this.applyLiveMessages(messages),
            error: (error) => this.handleRouteMessageError(error),
        });
        this.markCurrentContextAsRead();
    }

protected syncComposerState(): void {
        const shouldDisable = this.isSending;

        if (shouldDisable && this.messageControl.enabled) {
            this.messageControl.disable({ emitEvent: false });
            return;
        }

        if (!shouldDisable && this.messageControl.disabled) {
            this.messageControl.enable({ emitEvent: false });
        }
    }

protected applyLiveMessages(messages: Message[]): void {
        this.connectionHint = '';
        this.liveMessages = this.sortMessagesByTimestamp(messages);
        this.rebuildMessageList();
    }

protected rebuildMessageList(): void {
        const wasNearBottom = this.isNearBottom();
        const previousLastMessageKey = this.lastRenderedMessageKey;

        this.messages = this.mergeUniqueMessages(
            this.olderMessages,
            this.liveMessages,
        );
        this.messageGroups = this.buildMessageGroups(this.messages);
        this.seedHelloWorldIfNeeded();

        const nextLastMessageKey = this.getLastMessageKey(this.messages);
        const hasNewBottomMessage =
            !!nextLastMessageKey &&
            nextLastMessageKey !== previousLastMessageKey;

        this.lastRenderedMessageKey = nextLastMessageKey;

        if (this.pendingScrollToMessageId) {
            this.tryScrollToMessage();
            return;
        }

        if (this.pendingOlderScrollRestore) {
            this.restoreOlderMessagesScrollPosition();
            return;
        }

        if (this.forceScrollToBottomOnNextRender || wasNearBottom) {
            this.forceScrollToBottomOnNextRender = false;
            this.scrollToBottom();
            return;
        }

        if (hasNewBottomMessage) {
            this.showScrollToLatestButton = true;
        }

        //this.scrollToBottom();
    }

protected getMessageListElement(): HTMLElement | null {
        return this.messageListRef?.nativeElement ?? null;
    }

protected isNearBottom(): boolean {
        const container = this.getMessageListElement();
        if (!container) {
            return true;
        }

        const distanceFromBottom =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;

        return distanceFromBottom <= this.nearBottomThresholdPx;
    }

protected getLastMessageKey(messages: Message[]): string {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
            return '';
        }

        return (
            lastMessage.id ??
            this.trackMessage(messages.length - 1, lastMessage)
        );
    }

protected scrollToBottom(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            if (!container) {
                return;
            }

            container.scrollTop = container.scrollHeight;
            this.showScrollToLatestButton = false;
        }, 0);
    }

protected restoreOlderMessagesScrollPosition(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            const snapshot = this.pendingOlderScrollRestore;

            if (!container || !snapshot) {
                return;
            }

            const heightDelta =
                container.scrollHeight - snapshot.previousScrollHeight;

            container.scrollTop = snapshot.previousScrollTop + heightDelta;
            this.pendingOlderScrollRestore = null;
        }, 0);
    }

onMessageListScroll(): void {
        if (this.isNearBottom()) {
            this.showScrollToLatestButton = false;
        }
    }

scrollToLatestMessages(): void {
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

protected buildMessageGroups(messages: Message[]): MessageGroup[] {
        const groups: MessageGroup[] = [];

        for (const message of messages) {
            const lastGroup = groups[groups.length - 1];

            if (!lastGroup || this.shouldStartNewGroup(lastGroup, message)) {
                groups.push(this.createMessageGroup(message, groups.length));
                continue;
            }

            lastGroup.messages.push(message);
        }

        return groups;
    }
}
