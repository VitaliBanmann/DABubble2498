import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, Subscription, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import {
    Message,
    MessageReaction,
    MessageService,
} from '../services/message.service';
import { UiStateService } from '../services/ui-state.service';

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
        taegliches: 'tägliches',
        entwicklerteam: 'Entwicklerteam',
    };

    currentChannelId = 'entwicklerteam';
    messages: Message[] = [];
    readonly reactionPalette = ['👍', '✅', '🎉', '😄', '👀'];
    errorMessage = '';
    isSending = false;
    canWrite = false;
    private expandedReactionMessages = new Set<string>();
    private seededChannels = new Set<string>();
    private currentUserId: string | null = null;
    private readonly subscription = new Subscription();

    constructor(
        private readonly authService: AuthService,
        private readonly messageService: MessageService,
        private readonly route: ActivatedRoute,
        private readonly router: Router,
        private readonly ui: UiStateService,
    ) {}

    ngOnInit(): void {
        this.ui.openThread();

        this.subscription.add(
            this.authService.currentUser$.subscribe((user) => {
                this.currentUserId = user?.uid ?? null;
                this.canWrite = !!user && !user.isAnonymous;
                this.seedHelloWorldIfNeeded();
            }),
        );

        this.subscription.add(
            this.route.paramMap
                .pipe(
                    switchMap((params) => {
                        this.currentChannelId =
                            params.get('channelId') ?? 'entwicklerteam';
                        return this.messageService.getChannelMessages(
                            this.currentChannelId,
                        );
                    }),
                    distinctUntilChanged(),
                )
                .subscribe({
                    next: (messages) => {
                        this.messages = messages;
                        this.seedHelloWorldIfNeeded();
                    },
                    error: () => {
                        this.errorMessage =
                            'Nachrichten konnten nicht geladen werden.';
                    },
                }),
        );
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
        await this.authService.logout();
        await this.router.navigateByUrl('/');
    }

    sendMessage(): void {
        const text = this.messageControl.value.trim();
        if (!text || !this.currentChannelId) {
            return;
        }

        if (!this.canWrite) {
            this.errorMessage =
                'Als Gast kannst du keine Nachrichten senden.';
            return;
        }

        this.isSending = true;
        this.errorMessage = '';

        this.messageService
            .sendMessage({
                text,
                channelId: this.currentChannelId,
                senderId: this.currentUserId ?? '',
                timestamp: new Date(),
            })
            .subscribe({
                next: () => {
                    this.messageControl.setValue('');
                    this.isSending = false;
                },
                error: () => {
                    this.errorMessage =
                        'Nachricht konnte nicht gesendet werden.';
                    this.isSending = false;
                },
            });
    }

    get currentChannelName(): string {
        return this.channelNames[this.currentChannelId] ?? this.currentChannelId;
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
        if (!this.currentChannelId || !this.canWrite || this.messages.length > 0) {
            return;
        }

        if (this.seededChannels.has(this.currentChannelId)) {
            return;
        }

        this.seededChannels.add(this.currentChannelId);

        this.messageService
            .sendMessage({
                text: 'Hallo Welt!',
                channelId: this.currentChannelId,
                senderId: this.currentUserId ?? '',
                timestamp: new Date(),
            })
            .subscribe({
                error: () => {
                    this.seededChannels.delete(this.currentChannelId);
                },
            });
    }
}
