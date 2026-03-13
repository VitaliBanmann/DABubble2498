import {CommonModule} from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {ActivatedRoute, ParamMap, Router} from '@angular/router';
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
import {AuthFlowService} from '../services/auth-flow.service';
import {AuthService} from '../services/auth.service';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    MessageService,
    ThreadMessage,
} from '../services/message.service';
import {AttachmentService} from '../services/attachment.service';
import {UiStateService} from '../services/ui-state.service';
import {UnreadStateService} from '../services/unread-state.service';
import {User, UserService} from '../services/user.service';
import {User as FirebaseUser} from 'firebase/auth';

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

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
    readonly messageControl = new FormControl('', {nonNullable: true});
    readonly threadMessageControl = new FormControl('', {nonNullable: true});
    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };
    readonly composeTargetControl = new FormControl('', {nonNullable: true});

    get isComposeMode(): boolean {
        return this.ui.isNewMessageOpen();
    }

    private composeResolvedTarget:
        | { kind: 'channel'; channelId: string }
        | { kind: 'user'; userId: string }
        | null = null;
    composeTargetSuggestions: ComposeTargetSuggestion[] = [];
    composeTargetActiveIndex = -1;
    showComposeTargetSuggestions = false;
    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;
    messages: Message[] = [];
    threadMessages: ThreadMessage[] = [];
    messageGroups: MessageGroup[] = [];
    activeThreadParent: Message | null = null;
    errorMessage = '';
    connectionHint = '';
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
    private readonly messageGroupWindowMs = 5 * 60 * 1000;
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
    ) {
    }

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

    onComposeTargetInput(): void {
        this.composeTargetActiveIndex = -1;
        this.errorMessage = '';
        this.updateComposeTargetSuggestions();
    }

    selectComposeTargetSuggestion(suggestion: ComposeTargetSuggestion): void {
        this.composeTargetControl.setValue(suggestion.value);
        this.hideComposeTargetSuggestions();
    }

    private updateComposeTargetSuggestions(): void {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) return this.hideComposeTargetSuggestions();

        const query = raw.slice(1).trim().toLowerCase();
        if (raw.startsWith('#')) return this.setChannelSuggestions(query);
        if (raw.startsWith('@')) return this.setUserSuggestions(query);

        this.hideComposeTargetSuggestions();
    }

    private setChannelSuggestions(query: string): void {
        const entries = Object.entries(this.channelNames)
            .filter(([id, label]) => this.matchesQuery(query, id, label))
            .slice(0, 6)
            .map(([id, label]) => this.toChannelSuggestion(id, label));

        this.applyComposeSuggestions(entries);
    }

    onComposeTargetKeydown(event: KeyboardEvent): void {
        if (!this.showComposeTargetSuggestions) {
            if (event.key === 'Enter') this.onComposeTargetSubmit();
            return;
        }
        if (event.key === 'ArrowDown') return this.focusNextSuggestion(event);
        if (event.key === 'ArrowUp') return this.focusPreviousSuggestion(event);
        if (event.key === 'Enter') return this.confirmActiveSuggestion(event);
        if (event.key === 'Escape') this.hideComposeTargetSuggestions();
    }

    onComposeTargetBlur(): void {
        setTimeout(() => this.hideComposeTargetSuggestions(), 100);
    }

    onComposeTargetOptionMouseDown(
        suggestion: ComposeTargetSuggestion,
        event: MouseEvent,
    ): void {
        event.preventDefault();
        this.selectComposeTargetSuggestion(suggestion);
    }

    private focusNextSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(1);
    }

    private focusPreviousSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(-1);
    }

    private confirmActiveSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        const item =
            this.composeTargetSuggestions[this.composeTargetActiveIndex];
        if (item) this.selectComposeTargetSuggestion(item);
        else this.onComposeTargetSubmit();
    }

    private moveComposeSelection(step: number): void {
        const len = this.composeTargetSuggestions.length;
        if (!len) return;
        const start =
            this.composeTargetActiveIndex < 0
                ? step > 0
                    ? -1
                    : 0
                : this.composeTargetActiveIndex;
        this.composeTargetActiveIndex = (start + step + len) % len;
    }

    private setUserSuggestions(query: string): void {
        const entries = Object.values(this.usersById)
            .filter((user) => this.isValidSuggestionUser(user))
            .filter((user) =>
                this.matchesQuery(query, user.displayName, user.email ?? ''),
            )
            .slice(0, 6)
            .map((user) => this.toUserSuggestion(user));

        this.applyComposeSuggestions(entries);
    }

    private matchesQuery(
        query: string,
        primary: string,
        secondary: string,
    ): boolean {
        if (!query) return true;
        const left = primary.trim().toLowerCase();
        const right = secondary.trim().toLowerCase();
        return left.includes(query) || right.includes(query);
    }

    private isValidSuggestionUser(user: User): boolean {
        return !!user.id && user.id !== this.currentUserId;
    }

    private toChannelSuggestion(
        id: string,
        label: string,
    ): ComposeTargetSuggestion {
        return {
            kind: 'channel',
            id,
            label: `#${label}`,
            value: `#${id}`,
            subtitle: `Channel: #${id}`,
        };
    }

    private toUserSuggestion(user: User): ComposeTargetSuggestion {
        return {
            kind: 'user',
            id: user.id as string,
            label: `@${user.displayName}`,
            value: `@${user.displayName}`,
            subtitle: user.email ?? '',
        };
    }

    private applyComposeSuggestions(entries: ComposeTargetSuggestion[]): void {
        this.composeTargetSuggestions = entries;
        this.showComposeTargetSuggestions = entries.length > 0;
        this.composeTargetActiveIndex = entries.length ? 0 : -1;
    }

    private hideComposeTargetSuggestions(): void {
        this.composeTargetSuggestions = [];
        this.showComposeTargetSuggestions = false;
        this.composeTargetActiveIndex = -1;
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
        this.connectionHint = '';
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
            this.errorMessage =
                'Bitte gib ein Ziel ein (#channel, @user oder E-Mail).';
            this.composeResolvedTarget = null;
            return;
        }

        this.hideComposeTargetSuggestions();

        const channelId = this.resolveChannelTarget(raw);
        if (channelId) {
            this.composeResolvedTarget = {kind: 'channel', channelId};
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

            this.composeResolvedTarget = {kind: 'user', userId: user.id};
            this.errorMessage = '';
            return;
        }

        this.errorMessage =
            'Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.';
        this.composeResolvedTarget = null;
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
            this.messageControl.disable({emitEvent: false});
            return;
        }

        if (!shouldDisable && this.messageControl.disabled) {
            this.messageControl.enable({emitEvent: false});
        }
    }

    private applyLiveMessages(messages: Message[]): void {
        this.connectionHint = '';
        this.liveMessages = this.sortMessagesByTimestamp(messages);
        this.rebuildMessageList();
    }

    private rebuildMessageList(): void {
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
            !!nextLastMessageKey && nextLastMessageKey !== previousLastMessageKey;

        this.lastRenderedMessageKey = nextLastMessageKey;

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

    private getMessageListElement(): HTMLElement | null {
        return this.messageListRef?.nativeElement ?? null;
    }

    private isNearBottom(): boolean {
        const container = this.getMessageListElement();
        if (!container) {
            return true;
        }

        const distanceFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;

        return distanceFromBottom <= this.nearBottomThresholdPx;
    }

    private getLastMessageKey(messages: Message[]): string {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
            return '';
        }

        return lastMessage.id ?? this.trackMessage(messages.length - 1, lastMessage);
    }

    private scrollToBottom(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            if (!container) {
                return;
            }

            container.scrollTop = container.scrollHeight;
            this.showScrollToLatestButton = false;
        }, 0);
    }

    private restoreOlderMessagesScrollPosition(): void {
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

    @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;

    showScrollToLatestButton = false;

    private readonly nearBottomThresholdPx = 200;
    private forceScrollToBottomOnNextRender = true;
    private pendingOlderScrollRestore:
        | { previousScrollTop: number; previousScrollHeight: number }
        | null = null;
    private lastRenderedMessageKey = '';

    emojiPickerMessageId: string | null = null;

    readonly emojiPickerOptions: string[] = [
        '😀',
        '😂',
        '😍',
        '👍',
        '🎉',
        '🔥',
        '❤️',
        '🚀',
        '👏',
        '😮',
        '😢',
        '🙏',
    ];

    editingMessageId: string | null = null;
    readonly editMessageControl = new FormControl('', { nonNullable: true });
    isSavingEdit = false;

    private buildMessageGroups(messages: Message[]): MessageGroup[] {
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

    private shouldStartNewGroup(
        currentGroup: MessageGroup,
        nextMessage: Message,
    ): boolean {
        const previousMessage = currentGroup.messages[currentGroup.messages.length - 1];
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

    private createMessageGroup(message: Message, index: number): MessageGroup {
        const fallbackId = message.id ?? `${message.senderId}-${index}-${this.resolveTrackTimestamp(message.timestamp, index)}`;

        return {
            id: fallbackId,
            senderId: message.senderId,
            isOwn: this.isOwnMessage(message),
            startedAt: message.timestamp,
            messages: [message],
        };
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
        return this.canWrite && !this.isSending && (hasText || hasAttachments);
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

    private buildComposeSendRequest(text: string): Observable<string> {
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

        if (this.isComposeMode) {
            this.ui.closeNewMessage();
            this.composeTargetControl.setValue('');
            this.composeResolvedTarget = null;
        }

        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
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

    private normalizeAvatarPath(avatar: string, fallbackAvatar: string): string {
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

    onEmojiPickerClick(message: Message, event?: MouseEvent): void {
        event?.stopPropagation();

        if (!this.canWrite || !message.id) {
            return;
        }

        this.errorMessage = '';

        if (this.emojiPickerMessageId === message.id) {
            this.closeEmojiPicker();
            return;
        }

        this.emojiPickerMessageId = message.id;
    }

    isEmojiPickerOpen(message: Message): boolean {
        return !!message.id && this.emojiPickerMessageId === message.id;
    }

    selectEmojiFromPicker(message: Message, emoji: string, event?: MouseEvent): void {
        event?.stopPropagation();

        if (!message.id) {
            return;
        }

        this.toggleReaction(message, emoji);
        this.closeEmojiPicker();
    }

    closeEmojiPicker(): void {
        this.emojiPickerMessageId = null;
    }

    @HostListener('document:click')
    onDocumentClick(): void {
        this.closeEmojiPicker();
    }

    onEditMessageClick(message: Message): void {
        if (!this.canEditMessage(message) || !message.id) {
            return;
        }

        this.errorMessage = '';
        this.closeEmojiPicker();
        this.editingMessageId = message.id;
        this.editMessageControl.setValue((message.text ?? '').trim());
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
        if (!message.id || !this.isEditingMessage(message) || this.isSavingEdit) {
            return;
        }

        const nextText = this.editMessageControl.value.trim();
        const currentText = (message.text ?? '').trim();

        if (!nextText) {
            this.errorMessage = 'Die Nachricht darf nicht leer sein.';
            return;
        }

        if (nextText === currentText) {
            this.cancelMessageEdit();
            return;
        }

        this.isSavingEdit = true;
        this.errorMessage = '';

        this.messageService.updateMessage(message.id, {
            text: nextText,
        }).subscribe({
            next: () => {
                this.cancelMessageEdit();
            },
            error: (error) => {
                this.isSavingEdit = false;
                this.errorMessage = this.resolveSendError(error);
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
        this.messageGroups = [];
        this.hasMoreMessages = true;
        this.isLoadingMoreMessages = false;
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.pendingOlderScrollRestore = null;
        this.showScrollToLatestButton = false;
        this.editingMessageId = null;
        this.editMessageControl.setValue('');
        this.isSavingEdit = false;
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

    private prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
        this.forceScrollToBottomOnNextRender = true;
        this.showScrollToLatestButton = false;
        this.lastRenderedMessageKey = '';
    }

    private createDirectLiveStream(userId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestDirectMessages(userId, this.pageSize),
        );
    }

    private createChannelLiveStream(channelId: string): Observable<Message[]> {
        return this.withRealtimeReconnect(
            this.messageService.streamLatestChannelMessages(channelId, this.pageSize),
        );
    }

    private withRealtimeReconnect(stream$: Observable<Message[]>): Observable<Message[]> {
        return stream$.pipe(
            retry({
                count: 3,
                delay: (error, retryCount) => this.getReconnectDelay(error, retryCount),
            }),
        );
    }

    private getReconnectDelay(error: unknown, retryCount: number): Observable<number> {
        if (!this.isTransientStreamError(error)) {
            return throwError(() => error);
        }

        this.connectionHint = 'Verbindung instabil. Erneuter Verbindungsversuch...';
        const waitMs = Math.min(500 * 2 ** (retryCount - 1), 3000);
        return timer(waitMs);
    }

    private isTransientStreamError(error: unknown): boolean {
        const code = this.extractFirebaseErrorCode(error);
        return ['aborted', 'cancelled', 'deadline-exceeded', 'internal', 'unavailable', 'unknown'].includes(code);
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

    private createChannelMessagePayload(
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

    private formatDateAndTime(timestamp: Message['timestamp']): string {
        if (!timestamp) {
            return '';
        }

        const date = timestamp instanceof Date ? timestamp : this.tryToDate(timestamp);
        if (!date) {
            return '';
        }

        const day = date.toLocaleDateString('de-DE');
        const time = this.formatTime(date);
        return `${day}, ${time}`;
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

    private toDate(value: unknown): Date | null {
        if (!value) return null;

        if (value instanceof Date) {
            return isNaN(value.getTime()) ? null : value;
        }

        if (
            typeof value === 'object' &&
            value !== null &&
            'toDate' in value &&
            typeof (value as { toDate: () => Date }).toDate === 'function'
        ) {
            const date = (value as { toDate: () => Date }).toDate();
            return isNaN(date.getTime()) ? null : date;
        }

        if (typeof value === 'number') {
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date;
        }

        if (typeof value === 'string') {
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date;
        }

        return null;
    }

    private isSameCalendarDay(a: Date | null, b: Date | null): boolean {
        if (!a || !b) return false;

        return (
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate()
        );
    }

    private isWithinMessageGroupWindow(
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
        const previousDate = this.toDate(this.messageGroups[index - 1]?.startedAt);

        return !this.isSameCalendarDay(currentDate, previousDate);
    }

    getDateSeparatorLabel(timestamp: unknown): string {
        const date = this.toDate(timestamp);

        if (!date) return '';

        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (this.isSameCalendarDay(date, today)) {
            return 'Heute';
        }

        if (this.isSameCalendarDay(date, yesterday)) {
            return 'Gestern';
        }

        return new Intl.DateTimeFormat('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(date);
    }
}
