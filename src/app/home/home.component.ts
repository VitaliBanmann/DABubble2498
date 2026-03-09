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
    readonly composeTargetControl = new FormControl('', { nonNullable: true });

    get isComposeMode(): boolean {
        return this.ui.isNewMessageOpen();
    }

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
        if (directUserId)
            return this.applyDirectSnapshot(directUserId, directUserName);
        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
    }

    private subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe((incomingUser) =>
                this.handleAuthUserChange(incomingUser),
            ),
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
        if (!incomingUser) return this.resolveWhenIncomingMissing(inAppArea);
        if (!incomingUser.isAnonymous)
            return this.storeAndReturnUser(incomingUser);
        if (this.shouldReuseLastRegularUser(inAppArea))
            return this.lastStableUser;
        return this.storeAndReturnUser(incomingUser);
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
            combineLatest([
                this.authService.currentUser$,
                this.route.paramMap,
            ]).subscribe({
                next: ([user, params]) =>
                    this.handleRouteMessageContext(user, params),
                error: (error) => this.handleRouteMessageError(error),
            }),
        );
    }

    private handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.errorMessage = this.resolveLoadErrorMessage(error);
    }

    private resolveLoadErrorMessage(error: unknown): string {
        const code = this.extractFirebaseErrorCode(error);
        if (code === 'permission-denied')
            return 'Nachrichten konnten nicht geladen werden (Rechteproblem).';
        if (code === 'failed-precondition')
            return 'Nachrichten konnten nicht geladen werden (Index fehlt/noch im Aufbau).';
        return 'Nachrichten konnten nicht geladen werden.';
    }

    private extractFirebaseErrorCode(error: unknown): string {
        if (!error || typeof error !== 'object') return '';
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : '';
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

    async onComposeTargetSubmit(): Promise<void> {
    const raw = this.composeTargetControl.value.trim();
    if (!raw) {
        this.errorMessage = 'Bitte gib ein Ziel ein (#channel, @user oder E-Mail).';
        return;
    }

    const channelId = this.resolveChannelTarget(raw);
    if (channelId) {
        this.ui.closeNewMessage();
        this.composeTargetControl.setValue('');
        await this.router.navigate(['/app/channel', channelId]);
        return;
    }

    const user = this.resolveDirectTarget(raw);
    if (user?.id) {
        if (user.id === this.currentUserId) {
            this.errorMessage = 'Direktnachricht an dich selbst ist nicht nötig.';
            return;
        }

        this.ui.closeNewMessage();
        this.composeTargetControl.setValue('');
        await this.router.navigate(['/app/dm', user.id], {
            queryParams: { name: user.displayName },
        });
        return;
    }

    this.errorMessage = 'Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.';
    
}

private resolveChannelTarget(input: string): string | null {
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

private resolveDirectTarget(input: string): User | null {
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

    private setupDirectMessages(userId: string, name: string): void {
        this.ui.closeNewMessage();
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

    private setupChannelMessages(params: ParamMap): void {
        this.ui.closeNewMessage();
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
        if (!this.canLoadOlderMessages()) return;
        const oldestLoaded = this.messages[0];
        if (!oldestLoaded?.timestamp) return this.stopOlderLoading();
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
        if (
            (!text && !this.selectedAttachments.length) ||
            !this.validateSender()
        ) {
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
        if (!this.isAllowedAttachmentType(file))
            return this.setAttachmentError(
                'Erlaubt sind Bilder sowie PDF, DOCX und TXT.',
            );
        if (file.size > this.maxAttachmentSizeBytes)
            return this.setAttachmentError(
                'Eine Datei ist zu groß (max. 10 MB pro Datei).',
            );
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
                    this.applyFetchedDirectUserName(user, preferredName),
                error: () => this.applyDirectUserFallbackName(preferredName),
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
        this.hideMentionSuggestions();
    }

    private hideMentionSuggestions(): void {
        this.mentionSuggestions = [];
        this.showMentionSuggestions = false;
    }

    private subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];
        this.threadSubscription = this.messageService
            .getChannelThreadMessages(parentMessageId)
            .subscribe({
                next: (messages) => {
                    this.threadMessages = messages;
                },
                error: (error) => {
                    console.error('[THREAD READ ERROR]', error);
                    this.errorMessage =
                        'Thread-Nachrichten konnten nicht geladen werden.';
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

    private mergeUniqueMessages(
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

    private sortMessagesByTimestamp(messages: Message[]): Message[] {
        return [...messages].sort(
            (left, right) =>
                this.toTimestampMillis(left.timestamp) -
                this.toTimestampMillis(right.timestamp),
        );
    }

    private toTimestampMillis(timestamp: Message['timestamp']): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function')
            return timestamp.toMillis();
        if ('toDate' in timestamp && typeof timestamp.toDate === 'function')
            return timestamp.toDate().getTime();
        return 0;
    }

    private markCurrentContextAsRead(): void {
        if (!this.currentUserId || !this.canWrite) return;
        this.createReadMarkRequest()
            .pipe(take(1))
            .subscribe({
                error: (error) => console.error('[READ MARK ERROR]', error),
            });
    }

    private applyDirectSnapshot(userId: string, directUserName: string): void {
        this.isDirectMessage = true;
        this.currentDirectUserId = userId;
        this.currentDirectUserName = directUserName || userId;
    }

    private applyChannelSnapshot(channelId: string): void {
        this.isDirectMessage = false;
        this.currentDirectUserId = '';
        this.currentDirectUserName = '';
        this.currentChannelId = channelId;
    }

    private handleAuthUserChange(incomingUser: FirebaseUser | null): void {
        const stableUser = this.resolveStableAuthUser(incomingUser);
        this.deferUiUpdate(() => this.applyStableAuthUser(stableUser));
        this.logAuthEvent(incomingUser, stableUser);
    }

    private applyStableAuthUser(stableUser: FirebaseUser | null): void {
        this.authResolved = true;
        this.activeAuthUser = stableUser;
        this.currentUserId = stableUser?.uid ?? null;
        this.canWrite =
            !!stableUser && !stableUser.isAnonymous && !!stableUser.uid;
        this.syncComposerState();
        this.markCurrentContextAsRead();
    }

    private logAuthEvent(
        incomingUser: FirebaseUser | null,
        stableUser: FirebaseUser | null,
    ): void {
        console.log('[AUTH EVENT]', {
            uid: incomingUser?.uid ?? null,
            anon: incomingUser?.isAnonymous ?? null,
            stableUid: stableUser?.uid ?? null,
            stableAnon: stableUser?.isAnonymous ?? null,
            ts: Date.now(),
        });
    }

    private prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
    }

    private createDirectLiveStream(userId: string): Observable<Message[]> {
        return this.messageService.streamLatestDirectMessages(
            userId,
            this.pageSize,
        );
    }

    private createChannelLiveStream(channelId: string): Observable<Message[]> {
        return this.messageService.streamLatestChannelMessages(
            channelId,
            this.pageSize,
        );
    }

    private canLoadOlderMessages(): boolean {
        return !this.isLoadingMoreMessages && this.hasMoreMessages;
    }

    private stopOlderLoading(): void {
        this.hasMoreMessages = false;
    }

    private createOlderLoader(
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

    private applyOlderMessages(older: Message[]): void {
        const normalized = this.sortMessagesByTimestamp(older);
        this.olderMessages = this.mergeUniqueMessages(
            this.olderMessages,
            normalized,
        );
        this.hasMoreMessages = older.length >= this.pageSize;
        this.isLoadingMoreMessages = false;
        this.rebuildMessageList();
    }

    private handleOlderLoadError(error: unknown): void {
        this.isLoadingMoreMessages = false;
        this.handleRouteMessageError(error);
    }

    private canSendThreadMessage(): boolean {
        return (
            this.canWrite &&
            !this.isDirectMessage &&
            !!this.activeThreadParent?.id
        );
    }

    private onThreadSendSuccess(): void {
        this.threadMessageControl.setValue('');
        this.isThreadSending = false;
    }

    private onThreadSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isThreadSending = false;
    }

    private setAttachmentError(message: string): void {
        this.attachmentError = message;
    }

    private logChannelSendPayload(text: string, mentionsCount: number): void {
        console.log('[SEND PAYLOAD]', {
            text,
            channelId: this.currentChannelId,
            senderId: this.currentUserId,
            mentionsCount,
            attachmentsCount: this.selectedAttachments.length,
            canWrite: this.canWrite,
        });
    }

    private createReadMarkRequest(): Observable<void> {
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

    private resolveWhenIncomingMissing(
        inAppArea: boolean,
    ): FirebaseUser | null {
        if (this.shouldReuseLastRegularUser(inAppArea))
            return this.lastStableUser;
        this.lastStableUser = null;
        return null;
    }

    private storeAndReturnUser(user: FirebaseUser): FirebaseUser {
        this.lastStableUser = user;
        return user;
    }

    private shouldReuseLastRegularUser(inAppArea: boolean): boolean {
        return !!(
            inAppArea &&
            this.lastStableUser &&
            !this.lastStableUser.isAnonymous
        );
    }

    private rejectSender(message: string): boolean {
        this.errorMessage = message;
        return false;
    }

    private createChannelMessagePayload(text: string, mentions: string[]) {
        return {
            text,
            channelId: this.currentChannelId || 'allgemein',
            senderId: this.currentUserId ?? '',
            mentions,
            timestamp: new Date(),
        };
    }

    private tryToDate(timestamp: Message['timestamp']): Date | null {
        if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate();
        }
        return null;
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    private resolveTrackTimestamp(
        timestamp: Message['timestamp'],
        fallback: number,
    ): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function')
            return timestamp.toMillis();
        return fallback;
    }

    private applyFetchedDirectUserName(
        user: User | null,
        preferredName: string,
    ): void {
        this.currentDirectUserName =
            user?.displayName ?? preferredName ?? this.currentDirectUserId;
    }

    private applyDirectUserFallbackName(preferredName: string): void {
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
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
