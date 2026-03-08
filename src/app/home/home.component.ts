import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
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

    constructor(
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly messageService: MessageService,
        private readonly userService: UserService,
        private readonly route: ActivatedRoute,
        private readonly router: Router,
        private readonly ui: UiStateService,
    ) {}

    ngOnInit(): void {
        this.ui.openThread();
        this.subscribeToAuth();
        this.subscribeToUsers();
        this.subscribeToRouteMessages();
    }

    private subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe(() => {
                const activeUser = this.authService.getCurrentUser();
                this.currentUserId = activeUser?.uid ?? null;
                this.canWrite = !!activeUser && !activeUser.isAnonymous;
                this.seedHelloWorldIfNeeded();
            }),
        );
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
            combineLatest([this.authService.currentUser$, this.route.paramMap])
                .pipe(
                    switchMap(([user, params]) => {
                        if (!user) {
                            return of([] as Message[]);
                        }

                        return this.loadMessagesForRoute(params);
                    }),
                    distinctUntilChanged(),
                )
                .subscribe({
                    next: (messages) => this.handleMessagesLoaded(messages),
                    error: () =>
                        (this.errorMessage =
                            'Nachrichten konnten nicht geladen werden.'),
                }),
        );
    }

    private loadMessagesForRoute(params: any): Observable<Message[]> {
        const directUserId = params.get('userId') ?? '';
        const directUserName = this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        this.errorMessage = '';
        if (directUserId) return this.setupDirectMessages(directUserId, directUserName);
        return this.setupChannelMessages(params);
    }

    private setupDirectMessages(userId: string, name: string): Observable<Message[]> {
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
        const text = this.messageControl.value.trim();
        if (!text) {
            return;
        }

        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            this.errorMessage =
                'Du bist nicht angemeldet. Bitte melde dich erneut an.';
            return;
        }

        if (currentUser.isAnonymous) {
            this.errorMessage =
                'Als Gast kannst du keine Nachrichten senden.';
            return;
        }

        this.isSending = true;
        this.errorMessage = '';

        let request$: Observable<string>;
        try {
            request$ = this.isDirectMessage
                ? this.messageService.sendDirectMessage(
                      this.currentDirectUserId,
                      text,
                  )
                : this.messageService.sendMessage({
                      text,
                      channelId: this.currentChannelId || 'allgemein',
                      senderId: this.currentUserId ?? '',
                      timestamp: new Date(),
                  });
        } catch (error) {
            this.errorMessage =
                error instanceof Error
                    ? `Nachricht konnte nicht gesendet werden: ${error.message}`
                    : 'Nachricht konnte nicht gesendet werden.';
            this.isSending = false;
            return;
        }

        request$.subscribe({
            next: () => {
                this.messageControl.setValue('');
                this.isSending = false;
            },
            error: (error) => {
                this.errorMessage =
                    error instanceof Error
                        ? `Nachricht konnte nicht gesendet werden: ${error.message}`
                        : 'Nachricht konnte nicht gesendet werden.';
                this.isSending = false;
            },
        });
    }

    get currentChannelName(): string {
        return this.channelNames[this.currentChannelId] ?? this.currentChannelId;
    }

    get currentConversationTitle(): string {
        if (this.isDirectMessage) {
            const directUser = this.usersById[this.currentDirectUserId];
            return directUser?.displayName || this.currentDirectUserName || this.currentDirectUserId;
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

        return this.usersById[message.senderId]?.displayName ?? message.senderId;
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
        this.userService.getUser(this.currentDirectUserId).pipe(take(1)).subscribe({
            next: (user) => this.currentDirectUserName = user?.displayName ?? preferredName ?? this.currentDirectUserId,
            error: () => this.currentDirectUserName = preferredName || this.currentDirectUserId,
        });
    }
}
