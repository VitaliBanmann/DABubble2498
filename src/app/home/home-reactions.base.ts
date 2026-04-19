import { Injectable } from '@angular/core';
import { Message, MessageReaction } from '../services/message.service';
import { computeUpdatedReactions } from '../services/message.helpers';
import { HomeReactionsUiBase } from './home-reactions-ui.base';

@Injectable()
export abstract class HomeReactionsBase extends HomeReactionsUiBase {
    readonly defaultToolbarReactionEmojis = ['✅', '🎉'];

    private readonly collapsedReactionLimit = 7;
    private expandedReactionMessages = new Set<string>();

    protected abstract triggerViewUpdate(): void;

    isReactionListExpanded(message: Message): boolean {
        return !!message.id && this.expandedReactionMessages.has(message.id);
    }

    getVisibleReactions(message: Message): MessageReaction[] {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return reactions;
        return reactions.slice(0, this.collapsedReactionLimit);
    }

    getSortedVisibleReactions(message: Message): MessageReaction[] {
        return [...this.getVisibleReactions(message)].sort((a, b) => {
            const aR = this.hasCurrentUserReacted(a) ? 1 : 0;
            const bR = this.hasCurrentUserReacted(b) ? 1 : 0;
            if (aR !== bR) return bR - aR;

            const aC = typeof a.count === 'number' ? a.count : Number(a.count ?? 0);
            const bC = typeof b.count === 'number' ? b.count : Number(b.count ?? 0);
            return bC - aC;
        });
    }

    getHiddenReactionCount(message: Message): number {
        const reactions = message.reactions ?? [];
        if (!message.id || this.isReactionListExpanded(message)) return 0;
        return Math.max(reactions.length - this.collapsedReactionLimit, 0);
    }

    toggleReactionList(message: Message): void {
        if (!message.id) return;

        if (this.expandedReactionMessages.has(message.id)) {
            this.expandedReactionMessages.delete(message.id);
        } else {
            this.expandedReactionMessages.add(message.id);
        }
    }

    toggleReaction(message: Message, emoji: string): void {
        if (!this.canWrite || !message.id || !this.currentUserId) return;

        const previousReactions = this.cloneReactionState(message.reactions ?? []);
        const nextReactions = computeUpdatedReactions(message, emoji, this.currentUserId);

        this.applyOptimisticReactionUpdate(message, nextReactions);

        this.messageService
            .toggleReaction({
                messageId: message.id,
                emoji,
                isDirectMessage: this.isDirectMessage,
            })
            .subscribe({
                error: () => {
                    this.applyOptimisticReactionUpdate(message, previousReactions);
                    this.errorMessage = 'Reaktion konnte nicht aktualisiert werden.';
                },
            });
    }

    protected applyOptimisticReactionUpdate(
        message: Message,
        reactions: MessageReaction[],
    ): void {
        const messageId = message.id;
        if (!messageId) return;

        const clonedReactions = this.cloneReactionState(reactions);
        this.applyReactionStateToMessageCollections(message, messageId, clonedReactions);
        this.triggerViewUpdate();
    }

    protected replaceMessageReactions(
        messages: Message[],
        messageId: string,
        reactions: MessageReaction[],
    ): Message[] {
        return messages.map((entry) =>
            entry.id === messageId
                ? { ...entry, reactions: this.cloneReactionState(reactions) }
                : entry,
        );
    }

    protected cloneReactionState(reactions: MessageReaction[]): MessageReaction[] {
        return reactions.map((reaction) => ({
            ...reaction,
            userIds: [...reaction.userIds],
        }));
    }

    protected applyLocalReactionUpdate(
        messageId: string,
        reactions: MessageReaction[],
    ): void {
        this.liveMessages = this.updateReactionStateInMessages(
            this.liveMessages,
            messageId,
            reactions,
        );
        this.olderMessages = this.updateReactionStateInMessages(
            this.olderMessages,
            messageId,
            reactions,
        );
        this.messages = this.updateReactionStateInMessages(
            this.messages,
            messageId,
            reactions,
        );

        if (this.activeThreadParent?.id === messageId) {
            this.activeThreadParent = { ...this.activeThreadParent, reactions };
        }

        this.rebuildMessageList();
    }

    protected updateReactionStateInMessages(
        messages: Message[],
        messageId: string,
        reactions: MessageReaction[],
    ): Message[] {
        return messages.map((item) =>
            item.id === messageId
                ? {
                    ...item,
                    reactions: reactions.map((reaction) => ({
                        ...reaction,
                        userIds: [...reaction.userIds],
                    })),
                }
                : item,
        );
    }

    hasCurrentUserReacted(reaction: MessageReaction): boolean {
        return !!this.currentUserId && reaction.userIds.includes(this.currentUserId);
    }

    protected getReactionUserDisplayName(userId: string): string {
        if (!userId) return 'Unbekannt';
        if (userId === this.currentUserId) return 'Du';

        const displayName = (this.usersById[userId]?.displayName ?? '').trim();
        return displayName || userId;
    }

    getReactionUserDisplayNames(reaction: MessageReaction): string[] {
        const names = (reaction.userIds ?? [])
            .map((userId) => this.getReactionUserDisplayName(userId))
            .filter((name) => !!name);

        const uniqueNames = Array.from(new Set(names));

        return uniqueNames.sort((a, b) => {
            if (a === 'Du') return -1;
            if (b === 'Du') return 1;
            return a.localeCompare(b, 'de');
        });
    }

    getReactionTooltipLabel(reaction: MessageReaction): string {
        const names = this.getReactionUserDisplayNames(reaction);
        return names.length
            ? `${reaction.emoji} reagiert von ${names.join(', ')}`
            : `${reaction.emoji} Reaktion`;
    }


    hasMentionForCurrentUser(message: Message): boolean {
        return (
            !!this.currentUserId &&
            (message.mentions ?? []).includes(this.currentUserId)
        );
    }


    private applyReactionStateToMessageCollections(
        message: Message,
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        message.reactions = clonedReactions;
        this.updateReactionStateLists(messageId, clonedReactions);
        this.updateReactionStateGroups(messageId, clonedReactions);
        this.updateReactionStateThreadParent(messageId, clonedReactions);
    }

    private updateReactionStateLists(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        this.liveMessages = this.replaceMessageReactions(
            this.liveMessages,
            messageId,
            clonedReactions,
        );
        this.olderMessages = this.replaceMessageReactions(
            this.olderMessages,
            messageId,
            clonedReactions,
        );
        this.messages = this.replaceMessageReactions(
            this.messages,
            messageId,
            clonedReactions,
        );
    }

    private updateReactionStateGroups(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        this.messageGroups = this.messageGroups.map((group) => ({
            ...group,
            messages: group.messages.map((groupMessage) =>
                groupMessage.id === messageId
                    ? {
                        ...groupMessage,
                        reactions: this.cloneReactionState(clonedReactions),
                    }
                    : groupMessage,
            ),
        }));
    }

    private updateReactionStateThreadParent(
        messageId: string,
        clonedReactions: MessageReaction[],
    ): void {
        if (this.activeThreadParent?.id !== messageId) return;

        this.activeThreadParent = {
            ...this.activeThreadParent,
            reactions: this.cloneReactionState(clonedReactions),
        };
    }

}
