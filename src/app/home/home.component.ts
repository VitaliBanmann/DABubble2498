import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
    combineLatest,
    distinctUntilChanged,
    Observable,
    of,
    Subscription,
    switchMap,
    take,
} from 'rxjs';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import {
    Message,
    MessageReaction,
    MessageService,
} from '../services/message.service';
import { UiStateService } from '../services/ui-state.service';
import { User, UserService } from '../services/user.service';
import { User as FirebaseUser } from 'firebase/auth';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
    readonly messageControl = new FormControl('', { nonNullable: true });
    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };

    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;
    messages: Message[] = [];
    errorMessage = '';
    private hasSentWelcomeMessage = false;
    isSending = false;
    canWrite = false;
    private expandedReactionMessages = new Set<string>();
    private seededChannels = new Set<string>();
    private currentUserId: string | null = null;
    private usersById: Record<string, User> = {};
    private readonly subscription = new Subscription();
    private activeAuthUser: FirebaseUser | null = null;
    private lastStableUser: FirebaseUser | null = null;
    private readonly authRegressionWindowMs = 2000;
    private lastRegularUserAt = 0;
    authResolved = false;

    constructor(
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly messageService: MessageService,
        private readonly userService: UserService,
        private readonly route: ActivatedRoute,
        private readonly router: Router,
        private readonly ui: UiStateService,
        private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
    this.ui.openThread();
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
            this.createRouteMessagesStream().subscribe({
                next: (messages) => this.handleMessagesLoaded(messages),
                error: (error) => this.handleRouteMessageError(error),
            }),
        );
    }

    private createRouteMessagesStream(): Observable<Message[]> {
        return combineLatest([
            this.authService.currentUser$,
            this.route.paramMap,
        ]).pipe(
            switchMap(([user, params]) =>
                this.resolveRouteMessages(user, params),
            ),
            distinctUntilChanged(),
        );
    }

    private resolveRouteMessages(
        user: FirebaseUser | null,
        params: any,
    ): Observable<Message[]> {
        if (!user) {
            return of([] as Message[]);
        }

        return this.loadMessagesForRoute(params);
    }

    private handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.errorMessage = 'Nachrichten konnten nicht geladen werden.';
    }

    private loadMessagesForRoute(params: any): Observable<Message[]> {
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        this.errorMessage = '';
        if (directUserId)
            return this.setupDirectMessages(directUserId, directUserName);
        return this.setupChannelMessages(params);
    }

    private setupDirectMessages(
        userId: string,
        name: string,
    ): Observable<Message[]> {
        this.isDirectMessage = true;
        this.currentDirectUserId = userId;
        this.resolveCurrentDirectUserName(name);
        return this.messageService.getDirectMessages(userId);
    }

    private setupChannelMessages(params: any): Observable<Message[]> {
        this.isDirectMessage = false;
        this.currentDirectUserId = '';
        this.currentDirectUserName = '';
        this.currentChannelId = params.get('channelId') ?? 'allgemein';
        return this.messageService.getChannelMessages(this.currentChannelId);
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

    private handleMessagesLoaded(messages: Message[]): void {
        this.messages = messages;
        this.seedHelloWorldIfNeeded();
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    openThread(): void {
        this.ui.openThread();
    }
    closeThread(): void {
        this.ui.closeThread();
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
        if (!text || !this.validateSender()) {
            return null;
        }

        this.prepareSending();
        return this.buildSendRequest(text);
    }

    private readMessageText(): string {
        return this.messageControl.value.trim();
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
        return this.messageService.sendDirectMessage(
            this.currentDirectUserId,
            text,
            this.currentUserId ?? '',
        );
    }

    private buildChannelSendRequest(text: string): Observable<string> {
        console.log('[SEND PAYLOAD]', {
            text,
            channelId: this.currentChannelId,
            senderId: this.currentUserId,
            canWrite: this.canWrite,
        });
        return this.messageService.sendMessage({
            text,
            channelId: this.currentChannelId || 'allgemein',
            senderId: this.currentUserId ?? '',
            timestamp: new Date(),
        });
    }

    private onSendSuccess(): void {
        console.log('[SEND SUCCESS]');
        this.messageControl.setValue('');
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
}
