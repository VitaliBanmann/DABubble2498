import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    QueryList,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { User as FirebaseUser } from 'firebase/auth';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import {
    combineLatest,
    Observable,
    of,
    retry,
    Subscription,
    switchMap,
    take,
    throwError,
    timer,
} from 'rxjs';

import { ChannelPopupComponent } from '../layout/shell/channel-popup/channel-popup.component';
import { AddMemberToChannelComponent } from '../layout/shell/add-member-to-channel/add-member-to-channel.component';
import {
    ChannelMembersPopupComponent,
    ChannelMembersPopupEntry,
} from '../layout/shell/channel-members-popup/channel-members-popup.component';
import { AttachmentService } from '../services/attachment.service';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import { Channel, ChannelService } from '../services/channel.service';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    MessageService,
    ThreadMessage,
} from '../services/message.service';
import { UiStateService } from '../services/ui-state.service';
import { UnreadStateService } from '../services/unread-state.service';
import { User, UserService } from '../services/user.service';
import {
    ComposeTargetSuggestion,
    MentionCandidate,
    MessageGroup,
} from './home.component.models';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        PickerComponent,
        FormsModule,
        ChannelPopupComponent,
        AddMemberToChannelComponent,
        ChannelMembersPopupComponent,
    ],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
    [key: string]: any;

    /* ========================================
       Form Controls
    ======================================== */

    readonly messageControl = new FormControl('', { nonNullable: true });
    readonly threadMessageControl = new FormControl('', { nonNullable: true });
    readonly composeTargetControl = new FormControl('', { nonNullable: true });
    readonly editMessageControl = new FormControl('', { nonNullable: true });

    /* ========================================
       Static Channel Data
    ======================================== */

    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };

    readonly channelDescriptions: Record<string, string> = {
        allgemein:
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
        entwicklerteam:
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
    };

    /* ========================================
       Component Configuration
    ======================================== */

    private readonly composerMinHeightPx = 145;
    private readonly composerMaxHeightPx = 180;
    private readonly pageSize = 30;
    private readonly maxAttachmentSizeBytes = 10 * 1024 * 1024;
    private readonly messageGroupWindowMs = 5 * 60 * 1000;
    private readonly nearBottomThresholdPx = 200;
    private readonly authRegressionWindowMs = 2000;

    private readonly allowedAttachmentMimeTypes = new Set<string>([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
    ]);

    /* ========================================
       ViewChild / ViewChildren
    ======================================== */

    @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;
    @ViewChild('channelTitleTrigger')
    channelTitleTriggerRef?: ElementRef<HTMLElement>;
    @ViewChild('membersAvatarTrigger')
    membersAvatarTriggerRef?: ElementRef<HTMLElement>;
    @ViewChild('composerTextarea')
    composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

    @ViewChildren('editMessageTextarea')
    editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    /* ========================================
       UI State
    ======================================== */

    composeTargetSuggestions: ComposeTargetSuggestion[] = [];
    composeTargetActiveIndex = -1;
    showComposeTargetSuggestions = false;

    mentionSuggestions: MentionCandidate[] = [];
    showMentionSuggestions = false;

    selectedAttachments: File[] = [];
    attachmentError = '';

    errorMessage = '';
    connectionHint = '';

    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;

    messages: Message[] = [];
    threadMessages: ThreadMessage[] = [];
    messageGroups: MessageGroup[] = [];
    activeThreadParent: Message | null = null;

    hasSentWelcomeMessage = false;
    isSending = false;
    isThreadSending = false;
    isLoadingMoreMessages = false;
    hasMoreMessages = true;
    canWrite = false;
    authResolved = false;
    showScrollToLatestButton = false;
    isChannelPopupOpen = false;
    isAddMemberPopupOpen = false;
    isChannelMembersPopupOpen = false;
    channelPopupLeft = 24;
    channelPopupTop = 100;
    channelMembersPopupLeft = 24;
    channelMembersPopupTop = 120;
    editingMessageId: string | null = null;
    isSavingEdit = false;

    activeEmojiPicker:
        | { type: 'composer' }
        | { type: 'message'; messageId: string }
        | null = null;

    currentChannel: Channel | null = null;
    readonly maxVisibleChannelMembers = 3;

    /* ========================================
       Internal Runtime State
    ======================================== */

    private composeResolvedTarget:
        | { kind: 'channel'; channelId: string }
        | { kind: 'user'; userId: string }
        | null = null;

    private selectedMentions = new Map<string, MentionCandidate>();
    private expandedReactionMessages = new Set<string>();
    private seededChannels = new Set<string>();

    private currentUserId: string | null = null;
    private usersById: Record<string, User> = {};

    private readonly subscription = new Subscription();
    private threadSubscription: Subscription | null = null;
    private liveMessagesSubscription: Subscription | null = null;
    private currentChannelSubscription: Subscription | null = null;

    private liveMessages: Message[] = [];
    private olderMessages: Message[] = [];

    private activeAuthUser: FirebaseUser | null = null;
    private lastStableUser: FirebaseUser | null = null;
    private lastRegularUserAt = 0;

    private pendingScrollToMessageId: string | null = null;
    private forceScrollToBottomOnNextRender = true;
    private pendingOlderScrollRestore: {
        previousScrollTop: number;
        previousScrollHeight: number;
    } | null = null;
    private lastRenderedMessageKey = '';

    /* ========================================
       Constructor
    ======================================== */

    constructor(
        protected readonly authFlow: AuthFlowService,
        protected readonly authService: AuthService,
        protected readonly attachmentService: AttachmentService,
        protected readonly messageService: MessageService,
        protected readonly userService: UserService,
        protected readonly route: ActivatedRoute,
        protected readonly router: Router,
        protected readonly ui: UiStateService,
        protected readonly unreadStateService: UnreadStateService,
        protected readonly cdr: ChangeDetectorRef,
        protected readonly channelService: ChannelService,
    ) {}

    /* ========================================
       Getters
    ======================================== */

    get isComposeMode(): boolean {
        return this.ui.isNewMessageOpen();
    }

    get currentChannelDescription(): string {
        const liveDescription = (this.currentChannel?.description ?? '').trim();
        if (liveDescription) {
            return liveDescription;
        }

        return (
            this.channelDescriptions[this.currentChannelId] ??
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.'
        );
    }

    get currentChannelName(): string {
        const liveName = (this.currentChannel?.name ?? '').trim();
        if (liveName) {
            return liveName;
        }

        return this.channelNames[this.currentChannelId] ?? this.currentChannelId;
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

    /* ========================================
       Lifecycle
    ======================================== */

    ngOnInit(): void {
        this.ui.closeThread();
        this.initializeConversationFromSnapshot();
        this.subscribeToAuth();
        this.subscribeToUsers();
        this.subscribeToRouteMessages();
        this.subscribeToQueryParams();
        this.syncComposerState();
        setTimeout(() => this.resizeComposerTextarea(), 0);
    }

    ngOnDestroy(): void {
        this.threadSubscription?.unsubscribe();
        this.liveMessagesSubscription?.unsubscribe();
        this.currentChannelSubscription?.unsubscribe();
        this.subscription.unsubscribe();
    }

    /* ========================================
       Popup Actions
    ======================================== */

    openChannelPopup(): void {
        if (this.isComposeMode || this.isDirectMessage) {
            return;
        }

        this.positionChannelPopup();
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isChannelPopupOpen = true;
    }

    closeChannelPopup(): void {
        this.isChannelPopupOpen = false;
    }

    onChannelNameChanged(nextName: string): void {
        const name = nextName.trim();
        if (!name || this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        this.channelNames[this.currentChannelId] = name;

        if (this.currentChannel) {
            this.currentChannel = {
                ...this.currentChannel,
                name,
            };
        }

        this.channelService
            .updateChannel(this.currentChannelId, { name })
            .pipe(take(1))
            .subscribe({
                error: (error: unknown) =>
                    console.error('[CHANNEL NAME UPDATE ERROR]', error),
            });
    }

    onChannelDescriptionChanged(nextDescription: string): void {
        const description = nextDescription.trim();
        if (!description || this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        this.channelDescriptions[this.currentChannelId] = description;

        if (this.currentChannel) {
            this.currentChannel = {
                ...this.currentChannel,
                description,
            };
        }

        this.channelService
            .updateChannel(this.currentChannelId, { description })
            .pipe(take(1))
            .subscribe({
                error: (error: unknown) =>
                    console.error('[CHANNEL DESCRIPTION UPDATE ERROR]', error),
            });
    }

    onAddMemberClick(): void {
        this.isChannelPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isAddMemberPopupOpen = true;
    }

    closeAddMemberPopup(): void {
        this.isAddMemberPopupOpen = false;
    }

    openChannelMembersPopup(): void {
        if (this.isComposeMode || this.isDirectMessage) {
            return;
        }

        this.positionChannelMembersPopup();
        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = true;
    }

    closeChannelMembersPopup(): void {
        this.isChannelMembersPopupOpen = false;
    }

    protected positionChannelMembersPopup(): void {
        const triggerElement = this.membersAvatarTriggerRef?.nativeElement;
        if (!triggerElement) {
            return;
        }

        const rect = triggerElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const popupWidth = Math.min(415, viewportWidth - 48);
        const defaultLeft = Math.round(rect.right - popupWidth);
        const maxLeft = Math.max(24, viewportWidth - popupWidth - 24);

        this.channelMembersPopupLeft = Math.min(
            Math.max(defaultLeft, 24),
            maxLeft,
        );
        this.channelMembersPopupTop = Math.round(rect.bottom + 12);
    }

    protected positionChannelPopup(): void {
        const triggerElement = this.channelTitleTriggerRef?.nativeElement;
        if (!triggerElement) {
            return;
        }

        const rect = triggerElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const maxPopupWidth = Math.min(760, viewportWidth - 48);

        const defaultLeft = Math.round(rect.left);
        const maxLeft = Math.max(24, viewportWidth - maxPopupWidth - 24);

        this.channelPopupLeft = Math.min(Math.max(defaultLeft, 24), maxLeft);
        this.channelPopupTop = Math.round(rect.bottom + 12);
    }

    /* ========================================
       Initial Route / Snapshot Setup
    ======================================== */

    protected initializeConversationFromSnapshot(): void {
        const params = this.route.snapshot.paramMap;
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';

        if (directUserId) {
            this.applyDirectSnapshot(directUserId, directUserName);
            return;
        }

        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
    }

    protected subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe(
                (incomingUser: FirebaseUser | null) =>
                    this.handleAuthUserChange(incomingUser),
            ),
        );
    }

    protected subscribeToUsers(): void {
        this.subscription.add(
            this.userService.getAllUsers().subscribe({
                next: (users: User[]) => this.buildUserMap(users),
            }),
        );
    }

    protected subscribeToRouteMessages(): void {
        this.subscription.add(
            combineLatest({
                user: this.authService.currentUser$ as Observable<FirebaseUser | null>,
                params: this.route.paramMap as Observable<ParamMap>,
            }).subscribe({
                next: ({ user, params }) =>
                    this.handleRouteMessageContext(user, params),
                error: (error: unknown) => this.handleRouteMessageError(error),
            }),
        );
    }

    protected subscribeToQueryParams(): void {
        this.subscription.add(
            this.route.queryParamMap.subscribe((params: ParamMap) => {
                const msgId = params.get('msg');
                if (msgId) {
                    this.pendingScrollToMessageId = msgId;
                    this.tryScrollToMessage();
                }
            }),
        );
    }

    /* ========================================
       Auth Handling
    ======================================== */

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

    protected resolveStableAuthUser(
        incomingUser: FirebaseUser | null,
    ): FirebaseUser | null {
        const inAppArea = this.router.url.startsWith('/app');

        if (!incomingUser) {
            return this.resolveWhenIncomingMissing(inAppArea);
        }

        if (!incomingUser.isAnonymous) {
            return this.storeAndReturnUser(incomingUser);
        }

        if (this.shouldReuseLastRegularUser(inAppArea)) {
            return this.lastStableUser;
        }

        return this.storeAndReturnUser(incomingUser);
    }

    protected resolveWhenIncomingMissing(
        inAppArea: boolean,
    ): FirebaseUser | null {
        if (this.shouldReuseLastRegularUser(inAppArea)) {
            return this.lastStableUser;
        }

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

    protected deferUiUpdate(update: () => void): void {
        setTimeout(() => {
            update();
        }, 0);
    }

    /* ========================================
       Route Context / Message Context
    ======================================== */

    protected buildUserMap(users: User[]): void {
        this.usersById = users.reduce<Record<string, User>>((acc, user) => {
            if (user.id) acc[user.id] = user;
            return acc;
        }, {});

        this.resolveCurrentDirectUserName();
    }

    protected handleRouteMessageContext(
        user: FirebaseUser | null,
        params: ParamMap,
    ): void {
        if (!user) {
            this.clearMessagesState();
            return;
        }

        this.loadMessagesForRoute(params);
    }

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

    protected setupDirectMessages(userId: string, name: string): void {
        this.applyDirectSnapshot(userId, name);

        this.currentChannelSubscription?.unsubscribe();
        this.currentChannelSubscription = null;
        this.currentChannel = null;

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
        this.subscribeToCurrentChannel();
        this.prepareMessageStreamSwitch();

        this.liveMessagesSubscription = this.createChannelLiveStream(
            this.currentChannelId,
        ).subscribe({
            next: (messages: Message[]) => this.applyLiveMessages(messages),
            error: (error: unknown) => this.handleRouteMessageError(error),
        });

        this.markCurrentContextAsRead();
    }

    protected subscribeToCurrentChannel(): void {
        this.currentChannelSubscription?.unsubscribe();
        this.currentChannelSubscription = null;
        this.currentChannel = null;

        if (this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        this.currentChannelSubscription = this.channelService
            .getChannel(this.currentChannelId)
            .subscribe({
                next: (channel: Channel | null) => {
                    this.currentChannel = channel;
                },
                error: (error: unknown) => {
                    console.error('[CURRENT CHANNEL LOAD ERROR]', error);
                    this.currentChannel = null;
                },
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

    protected prepareMessageStreamSwitch(): void {
        this.resetMessageStreams();
        this.resetThreadPanel();
        this.forceScrollToBottomOnNextRender = true;
        this.showScrollToLatestButton = false;
        this.lastRenderedMessageKey = '';
    }

    protected clearMessagesState(): void {
        this.resetMessageStreams();
        this.messages = [];
    }

    protected handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.connectionHint = '';
        this.errorMessage = this.resolveLoadErrorMessage(error);
    }

    protected resolveLoadErrorMessage(error: unknown): string {
        const code = this.extractFirebaseErrorCode(error);

        if (code === 'permission-denied') {
            return 'Nachrichten konnten nicht geladen werden (Rechteproblem).';
        }

        if (code === 'failed-precondition') {
            return 'Nachrichten konnten nicht geladen werden (Index fehlt/noch im Aufbau).';
        }

        return 'Nachrichten konnten nicht geladen werden.';
    }

    protected extractFirebaseErrorCode(error: unknown): string {
        if (!error || typeof error !== 'object') {
            return '';
        }

        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : '';
    }

    /* ========================================
       Live Streams / Reconnect / Older Messages
    ======================================== */

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

    loadOlderMessages(): void {
        if (!this.canLoadOlderMessages()) return;

        const oldestLoaded = this.messages[0];
        if (!oldestLoaded?.timestamp) {
            this.stopOlderLoading();
            return;
        }

        this.captureOlderMessagesScroll();
        this.isLoadingMoreMessages = true;

        this.createOlderLoader(oldestLoaded.timestamp).subscribe({
            next: (older: Message[]) => this.applyOlderMessages(older),
            error: (error: unknown) => this.handleOlderLoadError(error),
        });
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

    protected captureOlderMessagesScroll(): void {
        const container = this.getMessageListElement();
        if (!container) return;

        this.pendingOlderScrollRestore = {
            previousScrollTop: container.scrollTop,
            previousScrollHeight: container.scrollHeight,
        };
    }

    /* ========================================
       Message List / Grouping / Scrolling
    ======================================== */

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
        this.updateRenderedMessageState(previousLastMessageKey, wasNearBottom);
    }

    protected updateRenderedMessageState(
        previousKey: string,
        wasNearBottom: boolean,
    ): void {
        const nextKey = this.getLastMessageKey(this.messages);
        const hasNewMessage = !!nextKey && nextKey !== previousKey;

        this.lastRenderedMessageKey = nextKey;

        if (this.pendingScrollToMessageId) return this.tryScrollToMessage();
        if (this.pendingOlderScrollRestore)
            return this.restoreOlderMessagesScrollPosition();
        if (this.forceScrollToBottomOnNextRender || wasNearBottom)
            return this.scrollAfterRender();

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

        return (
            this.getDistanceFromBottom(container) <=
            this.nearBottomThresholdPx
        );
    }

    protected getDistanceFromBottom(container: HTMLElement): number {
        return (
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight
        );
    }

    protected getLastMessageKey(messages: Message[]): string {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
            return '';
        }

        return lastMessage.id ?? this.trackMessage(messages.length - 1, lastMessage);
    }

    protected scrollToBottom(): void {
        setTimeout(() => {
            const container = this.getMessageListElement();
            if (!container) return;

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
        const heightDelta =
            container.scrollHeight - snapshot.previousScrollHeight;
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

    protected shouldStartNewGroup(
        currentGroup: MessageGroup,
        nextMessage: Message,
    ): boolean {
        const previousMessage = this.getPreviousGroupMessage(currentGroup);
        if (!previousMessage) return true;

        return this.hasGroupBoundary(currentGroup, nextMessage, previousMessage);
    }

    protected getPreviousGroupMessage(group: MessageGroup): Message | null {
        return group.messages[group.messages.length - 1] ?? null;
    }

    protected hasGroupBoundary(
        group: MessageGroup,
        next: Message,
        previous: Message,
    ): boolean {
        const previousDate = this.toDate(previous.timestamp);
        const nextDate = this.toDate(next.timestamp);

        return (
            group.senderId !== next.senderId ||
            !this.isSameCalendarDay(previousDate, nextDate) ||
            !this.isWithinMessageGroupWindow(next.timestamp, previous.timestamp)
        );
    }

    protected createMessageGroup(message: Message, index: number): MessageGroup {
        const fallbackId =
            message.id ??
            `${message.senderId}-${index}-${this.resolveTrackTimestamp(
                message.timestamp,
                index,
            )}`;

        return {
            id: fallbackId,
            senderId: message.senderId,
            isOwn: this.isOwnMessage(message),
            startedAt: message.timestamp,
            messages: [message],
        };
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

    /* ========================================
       Thread Handling
    ======================================== */

    openThread(): void {
        const firstMessage = this.messages[0];
        if (!firstMessage) return;

        this.openThreadForMessage(firstMessage);
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

    closeThread(): void {
        this.resetThreadPanel();
    }

    protected resetThreadPanel(): void {
        this.threadSubscription?.unsubscribe();
        this.threadSubscription = null;
        this.activeThreadParent = null;
        this.threadMessages = [];
        this.threadMessageControl.setValue('');
        this.ui.closeThread();
    }

    protected subscribeToThreadMessages(parentMessageId: string): void {
        this.threadSubscription?.unsubscribe();
        this.threadMessages = [];

        this.threadSubscription = this.messageService
            .getChannelThreadMessages(parentMessageId)
            .subscribe({
                next: (messages: ThreadMessage[]) =>
                    (this.threadMessages = messages),
                error: (error: unknown) => this.handleThreadReadError(error),
            });
    }

    protected handleThreadReadError(error: unknown): void {
        console.error('[THREAD READ ERROR]', error);
        this.errorMessage = 'Thread-Nachrichten konnten nicht geladen werden.';
    }

    sendThreadMessage(): void {
        if (!this.canSendThreadMessage()) return;

        const text = this.threadMessageControl.value.trim();
        if (!text) return;

        this.isThreadSending = true;

        this.createThreadMessageRequest(text).subscribe({
            next: () => this.onThreadSendSuccess(),
            error: (error: unknown) => this.onThreadSendError(error),
        });
    }

    protected canSendThreadMessage(): boolean {
        return (
            this.canWrite &&
            !this.isDirectMessage &&
            !!this.activeThreadParent?.id
        );
    }

    protected createThreadMessageRequest(text: string): Observable<string> {
        return this.messageService.sendChannelThreadMessage(
            this.activeThreadParent!.id!,
            text,
            this.currentUserId ?? '',
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

    /* ========================================
       Compose Target Handling
    ======================================== */

    onComposeTargetInput(): void {
        this.composeTargetActiveIndex = -1;
        this.errorMessage = '';
        this.updateComposeTargetSuggestions();
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
        if (!user?.id) {
            return this.applyComposeTargetError(
                'Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.',
            );
        }

        if (user.id === this.currentUserId) {
            return this.applyComposeTargetError(
                'Direktnachricht an dich selbst ist nicht noetig.',
            );
        }

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

        const channelByLabel = (
            Object.entries(this.channelNames) as Array<[string, string]>
        ).find(([, label]) => label.toLowerCase() === token);

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
        return users.find(
            (user) => (user.email ?? '').trim().toLowerCase() === token,
        );
    }

    protected findUserByName(users: User[], token: string): User | undefined {
        return users.find(
            (user) => (user.displayName ?? '').trim().toLowerCase() === token,
        );
    }

    protected findUserByPartialName(
        users: User[],
        token: string,
    ): User | undefined {
        return users.find((user) =>
            (user.displayName ?? '').trim().toLowerCase().includes(token),
        );
    }

    selectComposeTargetSuggestion(suggestion: ComposeTargetSuggestion): void {
        this.composeTargetControl.setValue(suggestion.value);
        this.hideComposeTargetSuggestions();
    }

    protected updateComposeTargetSuggestions(): void {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) return this.hideComposeTargetSuggestions();

        const query = raw.slice(1).trim().toLowerCase();

        if (raw.startsWith('#')) return this.setChannelSuggestions(query);
        if (raw.startsWith('@')) return this.setUserSuggestions(query);

        this.hideComposeTargetSuggestions();
    }

    protected setChannelSuggestions(query: string): void {
        const entries = (Object.entries(this.channelNames) as Array<
            [string, string]
        >)
            .filter(([id, label]) => this.matchesQuery(query, id, label))
            .slice(0, 6)
            .map(([id, label]) => this.toChannelSuggestion(id, label));

        this.applyComposeSuggestions(entries);
    }

    protected setUserSuggestions(query: string): void {
        const entries = (Object.values(this.usersById) as User[])
            .filter((user) => this.isValidSuggestionUser(user))
            .filter((user) =>
                this.matchesQuery(query, user.displayName, user.email ?? ''),
            )
            .slice(0, 6)
            .map((user) => this.toUserSuggestion(user));

        this.applyComposeSuggestions(entries);
    }

    protected matchesQuery(
        query: string,
        primary: string,
        secondary: string,
    ): boolean {
        if (!query) return true;

        const left = primary.trim().toLowerCase();
        const right = secondary.trim().toLowerCase();
        return left.includes(query) || right.includes(query);
    }

    protected isValidSuggestionUser(user: User): boolean {
        return !!user.id && user.id !== this.currentUserId;
    }

    protected toChannelSuggestion(
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

    protected toUserSuggestion(user: User): ComposeTargetSuggestion {
        return {
            kind: 'user',
            id: user.id as string,
            label: `@${user.displayName}`,
            value: `@${user.displayName}`,
            subtitle: user.email ?? '',
        };
    }

    protected applyComposeSuggestions(entries: ComposeTargetSuggestion[]): void {
        this.composeTargetSuggestions = entries;
        this.showComposeTargetSuggestions = entries.length > 0;
        this.composeTargetActiveIndex = entries.length ? 0 : -1;
    }

    protected hideComposeTargetSuggestions(): void {
        this.composeTargetSuggestions = [];
        this.showComposeTargetSuggestions = false;
        this.composeTargetActiveIndex = -1;
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

    protected focusNextSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(1);
    }

    protected focusPreviousSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(-1);
    }

    protected confirmActiveSuggestion(event: KeyboardEvent): void {
        event.preventDefault();

        const item =
            this.composeTargetSuggestions[this.composeTargetActiveIndex];

        if (item) {
            this.selectComposeTargetSuggestion(item);
        } else {
            this.onComposeTargetSubmit();
        }
    }

    protected moveComposeSelection(step: number): void {
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

    /* ========================================
       Sending Messages
    ======================================== */

    sendMessage(): void {
        if (this.isSending) return;
        if (this.isComposeMode) return void this.sendComposeMessage();

        this.sendPreparedRequest();
    }

    protected async sendComposeMessage(): Promise<void> {
        await this.onComposeTargetSubmit();

        if (!this.composeResolvedTarget) {
            this.applyComposeSendError();
            return;
        }

        this.sendPreparedRequest();
    }

    protected applyComposeSendError(): void {
        this.errorMessage =
            'Bitte zuerst einen gueltigen Empfaenger ueber #channel oder @name auswaehlen.';
    }

    protected sendPreparedRequest(): void {
        const request$ = this.prepareSendRequest();
        if (!request$) return;

        this.subscribeToSendRequest(request$);
    }

    protected prepareSendRequest(): Observable<string> | null {
        const text = this.readMessageText();

        if ((!text && !this.selectedAttachments.length) || !this.validateSender()) {
            return null;
        }

        this.prepareSending();
        return this.buildSendRequest(text);
    }

    protected readMessageText(): string {
        return this.messageControl.value.trim();
    }

    protected validateSender(): boolean {
        if (!this.activeAuthUser) {
            return this.rejectSender(
                'Du bist nicht angemeldet. Bitte melde dich erneut an.',
            );
        }

        if (this.activeAuthUser.isAnonymous || !this.currentUserId) {
            return this.rejectSender('Als Gast kannst du keine Nachrichten senden.');
        }

        return true;
    }

    protected rejectSender(message: string): boolean {
        this.errorMessage = message;
        return false;
    }

    protected prepareSending(): void {
        this.isSending = true;
        this.errorMessage = '';
        this.syncComposerState();
    }

    protected buildSendRequest(text: string): Observable<string> | null {
        try {
            if (this.isComposeMode) return this.buildComposeSendRequest(text);
            if (this.isDirectMessage) return this.buildDirectSendRequest(text);
            return this.buildChannelSendRequest(text);
        } catch (error) {
            this.onSendError(error);
            return null;
        }
    }

    protected buildComposeSendRequest(text: string): Observable<string> {
        const target = this.composeResolvedTarget;
        if (!target) throw new Error('Compose target missing');

        return target.kind === 'user'
            ? this.buildComposeDirectRequest(text, target.userId)
            : this.buildComposeChannelRequest(text, target.channelId);
    }

    protected buildComposeDirectRequest(
        text: string,
        userId: string,
    ): Observable<string> {
        return this.createDirectRequest(text, userId);
    }

    protected buildComposeChannelRequest(
        text: string,
        channelId: string,
    ): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const payload = this.createChannelMessagePayload(
            text,
            this.collectMentionIdsForText(text),
            channelId,
        );

        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap(
                (attachments: MessageAttachment[]): Observable<string> =>
                    this.messageService.sendMessageWithId(messageId, {
                        ...payload,
                        attachments,
                    }),
            ),
        );
    }

    protected buildDirectSendRequest(text: string): Observable<string> {
        return this.createDirectRequest(text, this.currentDirectUserId);
    }

    protected createDirectRequest(
        text: string,
        userId: string,
    ): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);

        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap(
                (attachments: MessageAttachment[]): Observable<string> =>
                    this.messageService.sendDirectMessageWithId(
                        messageId,
                        userId,
                        text,
                        this.currentUserId ?? '',
                        mentions,
                        attachments,
                    ),
            ),
        );
    }

    protected buildChannelSendRequest(text: string): Observable<string> {
        const messageId = this.messageService.createMessageId();
        const mentions = this.collectMentionIdsForText(text);

        this.logChannelSendPayload(text, mentions.length);

        const channelPayload = this.createChannelMessagePayload(text, mentions);

        return this.uploadAttachmentsForMessage(messageId).pipe(
            switchMap(
                (attachments: MessageAttachment[]): Observable<string> =>
                    this.messageService.sendMessageWithId(messageId, {
                        ...channelPayload,
                        attachments,
                    }),
            ),
        );
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

    protected logChannelSendPayload(
        _text: string,
        _mentionsCount: number,
    ): void {}

    protected subscribeToSendRequest(request$: Observable<string>): void {
        request$.subscribe({
            next: () => this.onSendSuccess(),
            error: (error: unknown) => this.onSendError(error),
        });
    }

    protected onSendSuccess(): void {
        this.resetComposerAfterSend();

        if (this.isComposeMode) {
            this.resetComposeTarget();
        }

        this.focusAfterSend();
    }

    protected resetComposerAfterSend(): void {
        this.messageControl.setValue('');
        this.clearMentionSelection();
        this.selectedAttachments = [];
        this.attachmentError = '';
        this.isSending = false;
        this.syncComposerState();
    }

    protected resetComposeTarget(): void {
        this.ui.closeNewMessage();
        this.composeTargetControl.setValue('');
        this.composeResolvedTarget = null;
    }

    protected focusAfterSend(): void {
        this.resizeComposerTextarea();
        this.focusComposerTextarea();
        this.forceScrollToBottomOnNextRender = true;
        this.scrollToBottom();
    }

    protected onSendError(error: unknown): void {
        this.errorMessage = this.resolveSendError(error);
        this.isSending = false;
        this.syncComposerState();
    }

    protected resolveSendError(error: unknown): string {
        return error instanceof Error
            ? `Nachricht konnte nicht gesendet werden: ${error.message}`
            : 'Nachricht konnte nicht gesendet werden.';
    }

    async logout(): Promise<void> {
        await this.authFlow.logoutToLogin();
    }

    /* ========================================
       Composer / Textarea / Keyboard
    ======================================== */

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

    onComposerInput(): void {
        this.updateMentionSuggestions();
        this.resizeComposerTextarea();
    }

    protected resizeComposerTextarea(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;

        textarea.style.height = `${this.composerMinHeightPx}px`;
        this.applyComposerHeight(textarea);
    }

    protected applyComposerHeight(textarea: HTMLTextAreaElement): void {
        const nextHeight = Math.min(
            textarea.scrollHeight,
            this.composerMaxHeightPx,
        );

        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY =
            textarea.scrollHeight > this.composerMaxHeightPx
                ? 'auto'
                : 'hidden';
    }

    protected focusComposerTextarea(): void {
        setTimeout(() => {
            const textarea = this.composerTextareaRef?.nativeElement;
            if (!textarea) return;

            textarea.focus();
        }, 0);
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

    canSendMessage(): boolean {
        const hasText = !!this.messageControl.value.trim();
        const hasAttachments = this.selectedAttachments.length > 0;
        return this.canWrite && !this.isSending && (hasText || hasAttachments);
    }

    /* ========================================
       Attachments
    ======================================== */

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
            (_file: File, currentIndex: number) => currentIndex !== index,
        );
    }

    protected addAttachmentIfValid(file: File): void {
        if (!this.isAllowedAttachmentType(file)) {
            return this.setAttachmentError(
                'Erlaubt sind Bilder sowie PDF, DOCX und TXT.',
            );
        }

        if (file.size > this.maxAttachmentSizeBytes) {
            return this.setAttachmentError(
                'Eine Datei ist zu groÃŸ (max. 10 MB pro Datei).',
            );
        }

        this.selectedAttachments = [...this.selectedAttachments, file];
    }

    protected isAllowedAttachmentType(file: File): boolean {
        if (file.type.startsWith('image/')) {
            return true;
        }

        return this.allowedAttachmentMimeTypes.has(file.type);
    }

    protected setAttachmentError(message: string): void {
        this.attachmentError = message;
    }

    protected uploadAttachmentsForMessage(
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

    /* ========================================
       Mentions
    ======================================== */

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

    insertMentionTrigger(): void {
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!textarea) return;

        const nextCursor = this.insertComposerText(textarea, '@');
        this.restoreMentionSelection(textarea, nextCursor);
    }

    protected restoreMentionSelection(
        textarea: HTMLTextAreaElement,
        nextCursor: number,
    ): void {
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = nextCursor;
            this.onComposerInput();
        }, 0);
    }

/* ========================================
   Reactions
======================================== */

    private readonly collapsedReactionLimit = 7;

    isReactionListExpanded(message: Message): boolean {
        if (!message.id) {
            return false;
        }

        return this.expandedReactionMessages.has(message.id);
    }

    getVisibleReactions(message: Message): MessageReaction[] {
        const reactions = message.reactions ?? [];

        if (!message.id || this.isReactionListExpanded(message)) {
            return reactions;
        }

        return reactions.slice(0, this.collapsedReactionLimit);
    }

    getSortedVisibleReactions(message: Message): MessageReaction[] {
        return [...this.getVisibleReactions(message)].sort((a, b) => {
            const aReacted = this.hasCurrentUserReacted(a) ? 1 : 0;
            const bReacted = this.hasCurrentUserReacted(b) ? 1 : 0;

            if (aReacted !== bReacted) {
                return bReacted - aReacted;
            }

            const aCount =
                typeof a.count === 'number' ? a.count : Number(a.count ?? 0);
            const bCount =
                typeof b.count === 'number' ? b.count : Number(b.count ?? 0);

            return bCount - aCount;
        });
    }

    getHiddenReactionCount(message: Message): number {
        const reactions = message.reactions ?? [];

        if (!message.id || this.isReactionListExpanded(message)) {
            return 0;
        }

        return Math.max(reactions.length - this.collapsedReactionLimit, 0);
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

        this.messageService
            .toggleReaction({
                messageId: message.id,
                emoji,
                isDirectMessage: this.isDirectMessage,
            })
            .subscribe({
                error: () => {
                    this.errorMessage = 'Reaktion konnte nicht aktualisiert werden.';
                },
            });
    }

    hasCurrentUserReacted(reaction: MessageReaction): boolean {
        if (!this.currentUserId) {
            return false;
        }

        return reaction.userIds.includes(this.currentUserId);
    }

    /* ========================================
       Message Editing
    ======================================== */

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
        return (
            !!message.id &&
            this.isEditingMessage(message) &&
            !this.isSavingEdit
        );
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
            if (!textarea) return;

            textarea.focus();
            const valueLength = textarea.value.length;
            textarea.setSelectionRange(valueLength, valueLength);
        }, 0);
    }

    /* ========================================
       Read Marking / Conversation State
    ======================================== */

    protected markCurrentContextAsRead(): void {
        if (!this.currentUserId || !this.canWrite) return;

        this.createReadMarkRequest()
            .pipe(take(1))
            .subscribe({
                error: (error) => console.error('[READ MARK ERROR]', error),
            });
    }

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

    /* ========================================
       Direct User Resolution
    ======================================== */

    protected resolveCurrentDirectUserName(preferredName = ''): void {
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

    protected fetchDirectUserName(preferredName: string): void {
        this.userService
            .getUser(this.currentDirectUserId)
            .pipe(take(1))
            .subscribe({
                next: (user: User | null) =>
                    this.applyFetchedDirectUserName(user, preferredName),
                error: () => this.applyDirectUserFallbackName(preferredName),
            });
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

    /* ========================================
       Display Helpers
    ======================================== */

    get visibleChannelMembers(): User[] {
        return this.getChannelMembers().slice(0, this.maxVisibleChannelMembers);
    }

    get channelMembersPopupEntries(): ChannelMembersPopupEntry[] {
        return this.getChannelMembers().map((user) => ({
            id: user.id ?? '',
            displayName: user.displayName,
            avatar: this.getUserAvatar(user),
            isSelf: !!user.id && user.id === this.currentUserId,
            isOnline: user.presenceStatus === 'online',
        }));
    }

    get remainingChannelMembersCount(): number {
        return Math.max(
            this.getChannelMembers().length - this.maxVisibleChannelMembers,
            0,
        );
    }

    get channelMembersCount(): number {
        return this.getChannelMembers().length;
    }

    getUserAvatar(user: User): string {
        const fallbackAvatar = 'assets/pictures/profile.svg';
        const rawAvatar = (user?.avatar ?? '').trim();

        if (!rawAvatar) {
            return fallbackAvatar;
        }

        return this.normalizeAvatarPath(rawAvatar, fallbackAvatar);
    }

    protected getChannelMembers(): User[] {
        const memberIds = this.extractChannelMemberIds();

        return memberIds
            .map((id) => this.usersById[id])
            .filter((user): user is User => !!user);
    }

    protected extractChannelMemberIds(): string[] {
        const channel = this.currentChannel as Record<string, unknown> | null;
        if (!channel) {
            return [];
        }

        const directMemberIds = channel['memberIds'];
        if (Array.isArray(directMemberIds)) {
            return directMemberIds.filter(
                (id): id is string => typeof id === 'string' && !!id,
            );
        }

        const directMembers = channel['members'];
        if (Array.isArray(directMembers)) {
            return directMembers
                .map((entry) => {
                    if (typeof entry === 'string') {
                        return entry;
                    }

                    if (
                        typeof entry === 'object' &&
                        entry &&
                        'id' in entry &&
                        typeof (entry as { id?: unknown }).id === 'string'
                    ) {
                        return (entry as { id: string }).id;
                    }

                    return null;
                })
                .filter((id): id is string => !!id);
        }

        return [];
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

        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getThreadSenderLabel(message: ThreadMessage): string {
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getVisibleChannelMembers(): User[] {
        return this.getChannelMembers().slice(0, this.maxVisibleChannelMembers);
    }

    getRemainingChannelMembersCount(): number {
        return Math.max(
            this.getChannelMembers().length - this.maxVisibleChannelMembers,
            0,
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

    protected normalizeAvatarPath(
        avatar: string,
        fallbackAvatar: string,
    ): string {
        const trimmed = avatar.trim();
        if (!trimmed) return fallbackAvatar;
        if (this.isExternalAvatar(trimmed) || this.isAssetAvatar(trimmed))
            return trimmed;
        return `assets/pictures/${trimmed}`;
    }

    protected isExternalAvatar(value: string): boolean {
        return ['http://', 'https://', 'data:', 'blob:'].some((prefix) =>
            value.startsWith(prefix),
        );
    }

    protected isAssetAvatar(value: string): boolean {
        return value.startsWith('/assets/') || value.startsWith('assets/');
    }

    hasMentionForCurrentUser(message: Message): boolean {
        if (!this.currentUserId) {
            return false;
        }

        return (message.mentions ?? []).includes(this.currentUserId);
    }

    isThreadParent(message: Message): boolean {
        return !!message.id && message.id === this.activeThreadParent?.id;
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

    getLastMessageOfGroup(group: MessageGroup): Message | null {
        return group.messages[group.messages.length - 1] ?? null;
    }

    protected seedHelloWorldIfNeeded(): void {
        // Seeding disabled to prevent duplicates
    }

    /* ========================================
       Date / Time Helpers
    ======================================== */

    protected toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return this.asValidDate(value);
        if (this.hasToDate(value)) return this.asValidDate(value.toDate());
        if (typeof value === 'number' || typeof value === 'string')
            return this.asValidDate(new Date(value));
        return null;
    }

    protected hasToDate(value: unknown): value is { toDate: () => Date } {
        return (
            typeof value === 'object' &&
            !!value &&
            'toDate' in value &&
            typeof value.toDate === 'function'
        );
    }

    protected asValidDate(value: Date): Date | null {
        return isNaN(value.getTime()) ? null : value;
    }

    protected tryToDate(timestamp: Message['timestamp']): Date | null {
        if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate();
        }
        return null;
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
        return new Intl.DateTimeFormat('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(date);
    }

    protected formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    protected formatDateAndTime(timestamp: Message['timestamp']): string {
        const date = this.tryToDate(timestamp);
        return date
            ? `${this.getDateSeparatorLabel(date)} ${this.formatTime(date)}`
            : '';
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

    /* ========================================
       Scroll-To-Message / Highlight
    ======================================== */

    protected tryScrollToMessage(): void {
        const msgId = this.pendingScrollToMessageId;
        if (!msgId) return;

        setTimeout(() => this.highlightScrolledMessage(msgId), 400);
    }

    protected highlightScrolledMessage(msgId: string): void {
        const el = document.getElementById('msg-' + msgId);
        if (!el) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message__line--highlight');
        this.pendingScrollToMessageId = null;

        setTimeout(() => el.classList.remove('message__line--highlight'), 2500);
    }

    /* ========================================
       Emoji Picker
    ======================================== */

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

        if (this.isMessageEmojiPickerOpen(message)) {
            return this.closeAllEmojiPickers();
        }

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

    onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) {
            return;
        }

        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

    protected insertComposerText(
        textarea: HTMLTextAreaElement,
        value: string,
    ): number {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentValue = this.messageControl.value ?? '';

        this.messageControl.setValue(
            currentValue.substring(0, start) +
            value +
            currentValue.substring(end),
        );

        return start + value.length;
    }

    protected restoreComposerSelection(
        textarea: HTMLTextAreaElement,
        nextCursor: number,
    ): void {
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = nextCursor;
            this.resizeComposerTextarea();
        }, 0);
    }

    /* ========================================
       Reset / Cleanup Helpers
    ======================================== */

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
}
