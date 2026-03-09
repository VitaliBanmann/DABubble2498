import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
    combineLatest,
    of,
    Observable,
    Subscription,
    switchMap,
    take,
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

interface MentionCandidate {
    id: string;
    label: string;
}

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
    readonly messageControl = new FormControl('', { nonNullable: true });
    readonly threadMessageControl = new FormControl('', { nonNullable: true });
    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };

    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;
    messages: Message[] = [];
    threadMessages: ThreadMessage[] = [];
    activeThreadParent: Message | null = null;
    errorMessage = '';
    mentionSuggestions: MentionCandidate[] = [];
    showMentionSuggestions = false;
    private selectedMentions = new Map<string, MentionCandidate>();
    selectedAttachments: File[] = [];
    attachmentError = '';
    private hasSentWelcomeMessage = false;
    isSending = false;
    isThreadSending = false;
    canWrite = false;
    private expandedReactionMessages = new Set<string>();
    private seededChannels = new Set<string>();
    private currentUserId: string | null = null;
    private usersById: Record<string, User> = {};
    private readonly subscription = new Subscription();
    private threadSubscription: Subscription | null = null;
    private liveMessagesSubscription: Subscription | null = null;
    private liveMessages: Message[] = [];
    private olderMessages: Message[] = [];
    private readonly pageSize = 30;
    private readonly maxAttachmentSizeBytes = 10 * 1024 * 1024;
    private readonly allowedAttachmentMimeTypes = new Set<string>([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
    ]);
    isLoadingMoreMessages = false;
    hasMoreMessages = true;
    private activeAuthUser: FirebaseUser | null = null;
    private lastStableUser: FirebaseUser | null = null;
    private readonly authRegressionWindowMs = 2000;
    private lastRegularUserAt = 0;
    authResolved = false;

    constructor(
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly attachmentService: AttachmentService,
        private readonly messageService: MessageService,
        private readonly userService: UserService,
        private readonly route: ActivatedRoute,
        private readonly router: Router,
        private readonly ui: UiStateService,
        private readonly unreadStateService: UnreadStateService,
        private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.ui.closeThread();
        this.initializeConversationFromSnapshot();
        this.subscribeToAuth();
        this.subscribeToUsers();
        this.subscribeToRouteMessages();
        this.syncComposerState();
    }

private initializeConversationFromSnapshot(): void {
    const params = this.route.snapshot.paramMap;
    const directUserId = params.get('userId') ?? '';
    const directUserName =
        this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';

    if (directUserId) {
        this.isDirectMessage = true;
        this.currentDirectUserId = directUserId;
        this.currentDirectUserName = directUserName || directUserId;
        return;
    }

    this.isDirectMessage = false;
    this.currentDirectUserId = '';
    this.currentDirectUserName = '';
    this.currentChannelId = params.get('channelId') ?? 'allgemein';
}

    private subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe((incomingUser) => {
                const stableUser = this.resolveStableAuthUser(incomingUser);

                this.deferUiUpdate(() => {
                    this.authResolved = true;
                    this.activeAuthUser = stableUser;
                    this.currentUserId = stableUser?.uid ?? null;
                    this.canWrite =
                        !!stableUser &&
                        !stableUser.isAnonymous &&
                        !!stableUser.uid;
                    this.syncComposerState();
                    this.markCurrentContextAsRead();
                });

                console.log('[AUTH EVENT]', {
                    uid: incomingUser?.uid ?? null,
                    anon: incomingUser?.isAnonymous ?? null,
                    stableUid: stableUser?.uid ?? null,
                    stableAnon: stableUser?.isAnonymous ?? null,
                    ts: Date.now(),
                });
            }),
        );
    }

    onSendButtonClick(): void {
        console.log('[SEND BUTTON CLICK]', {
            canWrite: this.canWrite,
            isSending: this.isSending,
            inputDisabled: this.messageControl.disabled,
            value: this.messageControl.value,
        });
    }

    private resolveStableAuthUser(
        incomingUser: FirebaseUser | null,
    ): FirebaseUser | null {
        const inAppArea = this.router.url.startsWith('/app');

        if (!incomingUser) {
            if (
                inAppArea &&
                this.lastStableUser &&
                !this.lastStableUser.isAnonymous
            ) {
                return this.lastStableUser;
            }
            this.lastStableUser = null;
            return null;
        }

        if (!incomingUser.isAnonymous) {
            this.lastStableUser = incomingUser;
            return incomingUser;
        }

        if (
            inAppArea &&
            this.lastStableUser &&
            !this.lastStableUser.isAnonymous
        ) {
            return this.lastStableUser;
        }

        this.lastStableUser = incomingUser;
        return incomingUser;
    }

    private deferUiUpdate(update: () => void): void {
        setTimeout(() => {
            update();
        }, 0);
    }

    private subscribeToUsers(): void {
        this.subscription.add(
            this.userService.getAllUsers().subscribe({
                next: (users) => this.buildUserMap(users),
            }),
        );
    }

    private buildUserMap(users: User[]): void {
        this.usersById = users.reduce<Record<string, User>>((acc, user) => {
            if (user.id) acc[user.id] = user;
            return acc;
        }, {});
        this.resolveCurrentDirectUserName();
    }

    private subscribeToRouteMessages(): void {
        this.subscription.add(
            combineLatest([this.authService.currentUser$, this.route.paramMap]).subscribe({
                next: ([user, params]) => this.handleRouteMessageContext(user, params),
                error: (error) => this.handleRouteMessageError(error),
            }),
        );
    }

    private handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.errorMessage = 'Nachrichten konnten nicht geladen werden.';
    }

    private handleRouteMessageContext(
        user: FirebaseUser | null,
        params: ParamMap,
    ): void {
        if (!user) {
            this.clearMessagesState();
            return;
        }

        this.loadMessagesForRoute(params);
    }

    private loadMessagesForRoute(params: ParamMap): void {
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

    private setupDirectMessages(userId: string, name: string): void {
        this.isDirectMessage = true;
        this.currentDirectUserId = userId;
        this.resolveCurrentDirectUserName(name);
        this.resetMessageStreams();
        this.resetThreadPanel();

        this.liveMessagesSubscription = this.messageService
            .streamLatestDirectMessages(userId, this.pageSize)
            .subscribe({
                next: (messages) => this.applyLiveMessages(messages),
                error: (error) => this.handleRouteMessageError(error),
            });
        this.markCurrentContextAsRead();
    }

    private setupChannelMessages(params: ParamMap): void {
        this.isDirectMessage = false;
        this.currentDirectUserId = '';
        this.currentDirectUserName = '';
        this.currentChannelId = params.get('channelId') ?? 'allgemein';
        this.resetMessageStreams();
        this.resetThreadPanel();

        this.liveMessagesSubscription = this.messageService
            .streamLatestChannelMessages(this.currentChannelId, this.pageSize)
            .subscribe({
                next: (messages) => this.applyLiveMessages(messages),
                error: (error) => this.handleRouteMessageError(error),
            });
        this.markCurrentContextAsRead();
    }

    private syncComposerState(): void {
        const shouldDisable = this.isSending;

        if (shouldDisable && this.messageControl.enabled) {
            this.messageControl.disable({ emitEvent: false });
            return;
        }

        if (!shouldDisable && this.messageControl.disabled) {
            this.messageControl.enable({ emitEvent: false });
        }
    }

    private applyLiveMessages(messages: Message[]): void {
        this.liveMessages = this.sortMessagesByTimestamp(messages);
        this.rebuildMessageList();
    }

    private rebuildMessageList(): void {
        this.messages = this.mergeUniqueMessages(
            this.olderMessages,
            this.liveMessages,
        );
        this.seedHelloWorldIfNeeded();
    }

    private clearMessagesState(): void {
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
        if (this.isLoadingMoreMessages || !this.hasMoreMessages) {
            return;
        }

        const oldestLoaded = this.messages[0];
        if (!oldestLoaded?.timestamp) {
            this.hasMoreMessages = false;
            return;
        }

        this.isLoadingMoreMessages = true;
        const loader$ = this.isDirectMessage
            ? this.messageService.loadOlderDirectMessages(
                  this.currentDirectUserId,
                  oldestLoaded.timestamp,
                  this.pageSize,
              )
            : this.messageService.loadOlderChannelMessages(
                  this.currentChannelId,
                  oldestLoaded.timestamp,
                  this.pageSize,
              );

        loader$.subscribe({
            next: (older) => {
                const normalized = this.sortMessagesByTimestamp(older);
                this.olderMessages = this.mergeUniqueMessages(
                    this.olderMessages,
                    normalized,
                );
                this.hasMoreMessages = older.length >= this.pageSize;
                this.isLoadingMoreMessages = false;
                this.rebuildMessageList();
            },
            error: (error) => {
                this.isLoadingMoreMessages = false;
                this.handleRouteMessageError(error);
            },
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
        if (!this.canWrite || this.isDirectMessage || !this.activeThreadParent?.id) {
            return;
        }

        const text = this.threadMessageControl.value.trim();
        if (!text) {
            return;
        }

        this.isThreadSending = true;
        this.messageService
            .sendChannelThreadMessage(
                this.activeThreadParent.id,
                text,
                this.currentUserId ?? '',
            )
            .subscribe({
                next: () => {
                    this.threadMessageControl.setValue('');
                    this.isThreadSending = false;
                },
                error: (error) => {
                    this.errorMessage = this.resolveSendError(error);
                    this.isThreadSending = false;
                },
            });
    }

    async logout(): Promise<void> {
        await this.authFlow.logoutToLogin();
    }

    sendMessage(): void {
        console.log('[SEND CLICKED]', {
            disabled: this.messageControl.disabled,
            value: this.messageControl.value,
            canWrite: this.canWrite,
            isSending: this.isSending,
        });
        const request$ = this.prepareSendRequest();
        if (!request$) {
            return;
        }
        this.subscribeToSendRequest(request$);
    }

    private prepareSendRequest(): Observable<string> | null {
        const text = this.readMessageText();
        if ((!text && !this.selectedAttachments.length) || !this.validateSender()) {
            return null;
        }

        this.prepareSending();
        return this.buildSendRequest(text);
    }

    private readMessageText(): string {
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
        return !this.isSending && (hasText || hasAttachments);
    }

    private addAttachmentIfValid(file: File): void {
        if (!this.isAllowedAttachmentType(file)) {
            this.attachmentError =
                'Erlaubt sind Bilder sowie PDF, DOCX und TXT.';
            return;
        }

        if (file.size > this.maxAttachmentSizeBytes) {
            this.attachmentError =
                'Eine Datei ist zu groß (max. 10 MB pro Datei).';
            return;
        }

        this.selectedAttachments = [...this.selectedAttachments, file];
    }

    private isAllowedAttachmentType(file: File): boolean {
        if (file.type.startsWith('image/')) {
            return true;
        }

        return this.allowedAttachmentMimeTypes.has(file.type);
    }

    onComposerInput(): void {
        this.updateMentionSuggestions();
    }

    private subscribeToSendRequest(request$: Observable<string>): void {
        request$.subscribe({
            next: () => this.onSendSuccess(),
            error: (error) => this.onSendError(error),
        });
    }

    private validateSender(): boolean {
        console.log('[SEND CHECK]', {
            activeUid: this.activeAuthUser?.uid ?? null,
            activeAnon: this.activeAuthUser?.isAnonymous ?? null,
            currentUserId: this.currentUserId,
            canWrite: this.canWrite,
            ts: Date.now(),
        });
        const user = this.activeAuthUser;

        if (!user) {
            this.errorMessage =
                'Du bist nicht angemeldet. Bitte melde dich erneut an.';
            return false;
        }

        if (user.isAnonymous || !this.currentUserId) {
            this.errorMessage = 'Als Gast kannst du keine Nachrichten senden.';
            return false;
        }

        return true;
    }

    private prepareSending(): void {
        this.isSending = true;
        this.errorMessage = '';
        this.syncComposerState();
    }

    private buildSendRequest(text: string): Observable<string> | null {
        try {
            if (this.isDirectMessage) {
                return this.buildDirectSendRequest(text);
            }

            return this.buildChannelSendRequest(text);
        } catch (error) {
            this.onSendError(error);
            return null;
        }
    }

    private buildDirectSendRequest(text: string): Observable<string> {
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

    private buildChannelSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);
        console.log('[SEND PAYLOAD]', {
            text,
            channelId: this.currentChannelId,
            senderId: this.currentUserId,
            mentionsCount: mentions.length,
            attachmentsCount: this.selectedAttachments.length,
            canWrite: this.canWrite,
        });
        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap((attachments) =>
                this.messageService.sendMessageWithId(messageId, {
                    text,
                    channelId: this.currentChannelId || 'allgemein',
                    senderId: this.currentUserId ?? '',
                    mentions,
                    attachments,
                    timestamp: new Date(),
                }),
            ),
        );
    }

    private uploadAttachmentsForMessage(
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

    private onSendSuccess(): void {
        console.log('[SEND SUCCESS]');
        this.messageControl.setValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();
    }

    private onSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isSending = false;
        this.syncComposerState();
        console.log('[SEND ERROR RAW]', error);
    }

    private resolveSendError(error: unknown): string {
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
        if (!timestamp) {
            return '';
        }

        if (timestamp instanceof Date) {
            return timestamp.toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        return '';
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

    hasMentionForCurrentUser(message: Message): boolean {
        if (!this.currentUserId) {
            return false;
        }

        return (message.mentions ?? []).includes(this.currentUserId);
    }

    selectMention(candidate: MentionCandidate): void {
        const value = this.messageControl.value;
        const mentionStart = value.lastIndexOf('@');
        if (mentionStart < 0) {
            return;
        }

        const before = value.slice(0, mentionStart);
        const mentionToken = `@${candidate.label} `;
        const nextValue = `${before}${mentionToken}`;
        this.messageControl.setValue(nextValue);
        this.selectedMentions.set(candidate.id, candidate);
        this.showMentionSuggestions = false;
        this.mentionSuggestions = [];
    }

    removeMention(candidateId: string): void {
        this.selectedMentions.delete(candidateId);
    }

    selectedMentionsList(): MentionCandidate[] {
        return Array.from(this.selectedMentions.values());
    }

    trackMessage(index: number, message: Message): string {
        if (message.id) {
            return message.id;
        }

        const timestamp =
            message.timestamp instanceof Date
                ? message.timestamp.getTime()
                : 'toMillis' in message.timestamp &&
                    typeof message.timestamp.toMillis === 'function'
                  ? message.timestamp.toMillis()
                  : index;

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

    private seedHelloWorldIfNeeded(): void {
        // Seeding disabled to prevent duplicates
    }

    private resolveCurrentDirectUserName(preferredName = ''): void {
        if (!this.currentDirectUserId) {
            this.currentDirectUserName = '';
            return;
        }
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
        const knownUser = this.usersById[this.currentDirectUserId];
        if (knownUser?.displayName) {
            this.currentDirectUserName = knownUser.displayName;
            return;
        }
        this.fetchDirectUserName(preferredName);
    }

    private fetchDirectUserName(preferredName: string): void {
        this.userService
            .getUser(this.currentDirectUserId)
            .pipe(take(1))
            .subscribe({
                next: (user) =>
                    (this.currentDirectUserName =
                        user?.displayName ??
                        preferredName ??
                        this.currentDirectUserId),
                error: () =>
                    (this.currentDirectUserName =
                        preferredName || this.currentDirectUserId),
            });
    }

    private updateMentionSuggestions(): void {
        const query = this.extractMentionQuery(this.messageControl.value);
        if (query === null) {
            this.showMentionSuggestions = false;
            this.mentionSuggestions = [];
            return;
        }

        this.mentionSuggestions = this.findMentionCandidates(query);
        this.showMentionSuggestions = this.mentionSuggestions.length > 0;
    }

    private extractMentionQuery(value: string): string | null {
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

    private findMentionCandidates(query: string): MentionCandidate[] {
        return Object.values(this.usersById)
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

    private collectMentionIdsForText(text: string): string[] {
        const normalizedText = text.toLowerCase();
        return this.selectedMentionsList()
            .filter((candidate) =>
                normalizedText.includes(`@${candidate.label.toLowerCase()}`),
            )
            .map((candidate) => candidate.id);
    }

    private clearMentionSelection(): void {
        this.selectedMentions.clear();
        this.mentionSuggestions = [];
        this.showMentionSuggestions = false;
    }

    private subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];
        this.threadSubscription =
            this.messageService.getChannelThreadMessages(parentMessageId).subscribe({
                next: (messages) => {
                    this.threadMessages = messages;
                },
                error: (error) => {
                    console.error('[THREAD READ ERROR]', error);
                    this.errorMessage = 'Thread-Nachrichten konnten nicht geladen werden.';
                },
            });
    }

    private resetMessageStreams(): void {
        this.liveMessagesSubscription?.unsubscribe();
        this.liveMessagesSubscription = null;
        this.liveMessages = [];
        this.olderMessages = [];
        this.messages = [];
        this.hasMoreMessages = true;
        this.isLoadingMoreMessages = false;
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
    }

    private mergeUniqueMessages(first: Message[], second: Message[]): Message[] {
        const merged = new Map<string, Message>();
        [...first, ...second].forEach((message, index) => {
            const key = message.id ?? this.trackMessage(index, message);
            merged.set(key, message);
        });

        return this.sortMessagesByTimestamp(Array.from(merged.values()));
    }

    private sortMessagesByTimestamp(messages: Message[]): Message[] {
        return [...messages].sort(
            (left, right) =>
                this.toTimestampMillis(left.timestamp) -
                this.toTimestampMillis(right.timestamp),
        );
    }

    private toTimestampMillis(timestamp: Message['timestamp']): number {
        if (timestamp instanceof Date) {
            return timestamp.getTime();
        }

        if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function') {
            return timestamp.toMillis();
        }

        if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().getTime();
        }

        return 0;
    }

    private markCurrentContextAsRead(): void {
        if (!this.currentUserId || !this.canWrite) {
            return;
        }

        const request$ = this.isDirectMessage
            ? this.unreadStateService.markDirectAsRead(
                  this.currentUserId,
                  this.currentDirectUserId,
              )
            : this.unreadStateService.markChannelAsRead(
                  this.currentUserId,
                  this.currentChannelId,
              );

        request$.pipe(take(1)).subscribe({
            error: (error) => {
                console.error('[READ MARK ERROR]', error);
            },
        });
    }

    private resetThreadPanel(): void {
        this.threadSubscription?.unsubscribe();
        this.threadSubscription = null;
        this.activeThreadParent = null;
        this.threadMessages = [];
        this.threadMessageControl.setValue('');
        this.ui.closeThread();
    }
}
