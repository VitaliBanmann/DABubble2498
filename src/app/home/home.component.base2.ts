import { Directive } from '@angular/core';
import { ParamMap } from '@angular/router';
import { Observable } from 'rxjs';
import { Message } from '../services/message.service';
import { User } from '../services/user.service';
import { MessageGroup } from './home.component.models';
import { HomeComponentBase1 } from './home.component.base1';

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
            this.applyComposeTargetError(
                'Bitte gib ein Ziel ein (#channel, @user oder E-Mail).',
            );
            return;
        }
        this.hideComposeTargetSuggestions();
        this.resolveComposeTarget(raw);
    }

    protected resolveComposeTarget(raw: string): void {
        const channelId = this.resolveChannelTarget(raw);
        if (channelId) return this.applyComposeChannelTarget(channelId);
        const user = this.resolveDirectTarget(raw);
        if (!user?.id) return this.applyComposeTargetError('Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.');
        if (user.id === this.currentUserId) return this.applyComposeTargetError('Direktnachricht an dich selbst ist nicht noetig.');
        this.composeResolvedTarget = { kind: 'user', userId: user.id };
        this.errorMessage = '';
    }

    protected applyComposeChannelTarget(channelId: string): void {
        this.composeResolvedTarget = { kind: 'channel', channelId };
        this.errorMessage = '';
    }

    protected applyComposeTargetError(message: string): void {
        this.errorMessage = message;
        this.composeResolvedTarget = null;
    }

protected resolveChannelTarget(input: string): string | null {
        const token = input.replace(/^#/, '').trim().toLowerCase();
        if (!token) return null;

        const channelById = Object.keys(this.channelNames).find(
            (id) => id.toLowerCase() === token,
        );
        if (channelById) return channelById;

        const channelByLabel = (Object.entries(this.channelNames) as Array<[string, string]>).find(
            ([, label]) => label.toLowerCase() === token,
        );
        return channelByLabel?.[0] ?? null;
    }

protected resolveDirectTarget(input: string): User | null {
        const token = input.replace(/^@/, '').trim().toLowerCase();
        if (!token) return null;
    const allUsers = Object.values(this.usersById) as User[];
        return this.findDirectTargetMatch(allUsers, token);
    }

    protected findDirectTargetMatch(users: User[], token: string): User | null {
        return (
            this.findUserByEmail(users, token) ||
            this.findUserByName(users, token) ||
            this.findUserByPartialName(users, token) ||
            null
        );
    }

    protected findUserByEmail(users: User[], token: string): User | undefined {
        return users.find((user) => (user.email ?? '').trim().toLowerCase() === token);
    }

    protected findUserByName(users: User[], token: string): User | undefined {
        return users.find((user) => (user.displayName ?? '').trim().toLowerCase() === token);
    }

    protected findUserByPartialName(users: User[], token: string): User | undefined {
        return users.find((user) => (user.displayName ?? '').trim().toLowerCase().includes(token));
    }

protected setupDirectMessages(userId: string, name: string): void {
        this.applyDirectSnapshot(userId, name);
        this.prepareMessageStreamSwitch();
        this.liveMessagesSubscription = this.createDirectLiveStream(
            userId,
        ).subscribe({
            next: (messages: Message[]) => this.applyLiveMessages(messages),
            error: (error: unknown) => this.handleRouteMessageError(error),
        });
        this.markCurrentContextAsRead();
    }

protected setupChannelMessages(params: ParamMap): void {
        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
        this.prepareMessageStreamSwitch();
        this.liveMessagesSubscription = this.createChannelLiveStream(
            this.currentChannelId,
        ).subscribe({
            next: (messages: Message[]) => this.applyLiveMessages(messages),
            error: (error: unknown) => this.handleRouteMessageError(error),
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
        this.messages = this.mergeUniqueMessages(this.olderMessages, this.liveMessages);
        this.messageGroups = this.buildMessageGroups(this.messages);
        this.seedHelloWorldIfNeeded();
        this.updateRenderedMessageState(previousLastMessageKey, wasNearBottom);
    }

    protected updateRenderedMessageState(previousKey: string, wasNearBottom: boolean): void {
        const nextKey = this.getLastMessageKey(this.messages);
        const hasNewMessage = !!nextKey && nextKey !== previousKey;
        this.lastRenderedMessageKey = nextKey;
        if (this.pendingScrollToMessageId) return this.tryScrollToMessage();
        if (this.pendingOlderScrollRestore) return this.restoreOlderMessagesScrollPosition();
        if (this.forceScrollToBottomOnNextRender || wasNearBottom) return this.scrollAfterRender();
        this.showScrollToLatestButton = hasNewMessage;
    }

    protected scrollAfterRender(): void {
        this.forceScrollToBottomOnNextRender = false;
        this.scrollToBottom();
    }

protected getMessageListElement(): HTMLElement | null {
        return this.messageListRef?.nativeElement ?? null;
    }

protected isNearBottom(): boolean {
        const container = this.getMessageListElement();
        if (!container) return true;
        return this.getDistanceFromBottom(container) <= this.nearBottomThresholdPx;
    }

    protected getDistanceFromBottom(container: HTMLElement): number {
        return container.scrollHeight - container.scrollTop - container.clientHeight;
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
            const snapshot = this.pendingOlderScrollRestore;
            const container = this.getMessageListElement();
            if (!container || !snapshot) return;
            this.restoreScrollPosition(container, snapshot);
        }, 0);
    }

    protected restoreScrollPosition(
        container: HTMLElement,
        snapshot: { previousScrollTop: number; previousScrollHeight: number },
    ): void {
        const heightDelta = container.scrollHeight - snapshot.previousScrollHeight;
        container.scrollTop = snapshot.previousScrollTop + heightDelta;
        this.pendingOlderScrollRestore = null;
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
            this.appendMessageGroup(groups, message);
        }
        return groups;
    }

    protected appendMessageGroup(groups: MessageGroup[], message: Message): void {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || this.shouldStartNewGroup(lastGroup, message)) {
            groups.push(this.createMessageGroup(message, groups.length));
            return;
        }
        lastGroup.messages.push(message);
    }
}
