import { Directive } from '@angular/core';
import { take } from 'rxjs';
import { Message, MessageReaction, ThreadMessage } from '../services/message.service';
import { User } from '../services/user.service';
import { MentionCandidate } from './home.component.models';
import { HomeComponentBase4 } from './home.component.base4';

@Directive()
export class HomeComponentBase5 extends HomeComponentBase4 {
    [key: string]: any;

    getHiddenReactionCount(message: Message): number {
        const reactions = message.reactions ?? [];
        if (!message.id || this.expandedReactionMessages.has(message.id)) {
            return 0;
        }

        return Math.max(reactions.length - 20, 0);
    }

toggleReactionList(message: Message): void {
        if (!message.id) {
            return;
        }

        if (this.expandedReactionMessages.has(message.id)) {
            this.expandedReactionMessages.delete(message.id);
            return;
        }

        this.expandedReactionMessages.add(message.id);
    }

toggleReaction(message: Message, emoji: string): void {
        if (!this.canWrite || !message.id) {
            return;
        }

        this.messageService.toggleReaction(message.id, emoji).subscribe({
            error: () => {
                this.errorMessage =
                    'Reaktion konnte nicht aktualisiert werden.';
            },
        });
    }

canOpenThreadFromToolbar(message: Message): boolean {
        return !this.isDirectMessage && !!message.id;
    }

canEditMessage(message: Message): boolean {
        return this.isOwnMessage(message) && !!message.id;
    }

onEditMessageClick(message: Message): void {
        if (!this.canEditMessage(message) || !message.id) {
            return;
        }

        this.errorMessage = '';
        this.editingMessageId = message.id;
        this.editMessageControl.setValue((message.text ?? '').trim());
        this.focusActiveEditTextarea();
    }

isEditingMessage(message: Message): boolean {
        return !!message.id && this.editingMessageId === message.id;
    }

cancelMessageEdit(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

saveMessageEdit(message: Message): void {
        if (!this.canSaveMessageEdit(message)) return;
        const nextText = this.editMessageControl.value.trim();
        const currentText = (message.text ?? '').trim();
        if (!nextText) return void this.applyEmptyEditError();
        if (nextText === currentText) return this.cancelMessageEdit();
        this.isSavingEdit = true;
        this.errorMessage = '';
        this.messageService.updateMessage(message.id!, { text: nextText }).subscribe({
            next: () => this.cancelMessageEdit(),
            error: (error: unknown) => this.handleSaveEditError(error),
        });
    }

    protected canSaveMessageEdit(message: Message): boolean {
        return !!message.id && this.isEditingMessage(message) && !this.isSavingEdit;
    }

    protected applyEmptyEditError(): void {
        this.errorMessage = 'Die Nachricht darf nicht leer sein.';
    }

    protected handleSaveEditError(error: unknown): void {
        this.isSavingEdit = false;
        this.errorMessage = this.resolveSendError(error);
    }

onEditTextareaKeydown(event: KeyboardEvent, message: Message): void {
        if (event.key === 'Escape') return this.cancelEditFromKeyboard(event);
        if (!this.isEditSubmitShortcut(event)) return;
        event.preventDefault();
        this.saveMessageEdit(message);
    }

    protected cancelEditFromKeyboard(event: KeyboardEvent): void {
        event.preventDefault();
        this.cancelMessageEdit();
    }

    protected isEditSubmitShortcut(event: KeyboardEvent): boolean {
        return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
    }

protected focusActiveEditTextarea(): void {
        setTimeout(() => {
            const textarea = this.editMessageTextareas?.last?.nativeElement;
            if (!textarea) {
                return;
            }

            textarea.focus();
            const valueLength = textarea.value.length;
            textarea.setSelectionRange(valueLength, valueLength);
        }, 0);
    }

hasCurrentUserReacted(reaction: MessageReaction): boolean {
        if (!this.currentUserId) {
            return false;
        }

        return reaction.userIds.includes(this.currentUserId);
    }

getThreadSenderLabel(message: ThreadMessage): string {
        return (
            this.usersById[message.senderId]?.displayName ?? message.senderId
        );
    }

protected seedHelloWorldIfNeeded(): void {
        // Seeding disabled to prevent duplicates
    }

protected resolveCurrentDirectUserName(preferredName = ''): void {
        if (!this.currentDirectUserId) return void (this.currentDirectUserName = '');
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
        const knownUser = this.usersById[this.currentDirectUserId];
        if (knownUser?.displayName) return void (this.currentDirectUserName = knownUser.displayName);
        this.fetchDirectUserName(preferredName);
    }

protected fetchDirectUserName(preferredName: string): void {
        this.userService
            .getUser(this.currentDirectUserId)
            .pipe(take(1))
            .subscribe({
                next: (user: User) =>
                    this.applyFetchedDirectUserName(user, preferredName),
                error: () => this.applyDirectUserFallbackName(preferredName),
            });
    }

protected updateMentionSuggestions(): void {
        const query = this.extractMentionQuery(this.messageControl.value);
        if (query === null) {
            this.showMentionSuggestions = false;
            this.mentionSuggestions = [];
            return;
        }

        this.mentionSuggestions = this.findMentionCandidates(query);
        this.showMentionSuggestions = this.mentionSuggestions.length > 0;
    }

protected extractMentionQuery(value: string): string | null {
        const mentionStart = value.lastIndexOf('@');
        if (mentionStart < 0) {
            return null;
        }

        const tail = value.slice(mentionStart + 1);
        if (tail.includes(' ')) {
            return null;
        }

        return tail.trim().toLowerCase();
    }

protected findMentionCandidates(query: string): MentionCandidate[] {
    return (Object.values(this.usersById) as User[])
            .filter((user) => !!user.id && user.id !== this.currentUserId)
            .map((user) => ({
                id: user.id as string,
                label: user.displayName,
            }))
            .filter((candidate) =>
                candidate.label.toLowerCase().includes(query),
            )
            .slice(0, 6);
    }

protected collectMentionIdsForText(text: string): string[] {
        const normalizedText = text.toLowerCase();
        return this.selectedMentionsList()
            .filter((candidate) =>
                normalizedText.includes(`@${candidate.label.toLowerCase()}`),
            )
            .map((candidate) => candidate.id);
    }

protected clearMentionSelection(): void {
        this.selectedMentions.clear();
        this.hideMentionSuggestions();
    }

protected hideMentionSuggestions(): void {
        this.mentionSuggestions = [];
        this.showMentionSuggestions = false;
    }

protected subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];
        this.threadSubscription = this.messageService.getChannelThreadMessages(parentMessageId).subscribe({
            next: (messages: ThreadMessage[]) => (this.threadMessages = messages),
            error: (error: unknown) => this.handleThreadReadError(error),
        });
    }

    protected handleThreadReadError(error: unknown): void {
        console.error('[THREAD READ ERROR]', error);
        this.errorMessage = 'Thread-Nachrichten konnten nicht geladen werden.';
    }

protected resetMessageStreams(): void {
        this.resetLiveCollections();
        this.resetComposerTransientState();
        this.resetEditState();
    }

    protected resetLiveCollections(): void {
        this.liveMessagesSubscription?.unsubscribe();
        this.liveMessagesSubscription = null;
        this.liveMessages = [];
        this.olderMessages = [];
        this.messages = [];
        this.messageGroups = [];
        this.hasMoreMessages = true;
        this.isLoadingMoreMessages = false;
    }

    protected resetComposerTransientState(): void {
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.pendingOlderScrollRestore = null;
        this.showScrollToLatestButton = false;
    }

    protected resetEditState(): void {
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
    }

protected mergeUniqueMessages(
        first: Message[],
        second: Message[],
    ): Message[] {
        const merged = new Map<string, Message>();
        [...first, ...second].forEach((message, index) => {
            const key = message.id ?? this.trackMessage(index, message);
            merged.set(key, message);
        });

        return this.sortMessagesByTimestamp(Array.from(merged.values()));
    }
}
