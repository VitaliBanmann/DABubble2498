import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { combineLatest, Subscription, catchError, of, switchMap, take } from 'rxjs';
import { UiStateService } from '../../services/ui-state.service';
import { AuthService } from '../../services/auth.service';
import { PresenceService } from '../../services/presence.service';
import { PresenceStatus, UserService } from '../../services/user.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';

interface SearchChannelResult {
    id: string;
    name: string;
}

interface SearchUserResult {
    id: string;
    name: string;
    email: string;
}

interface SearchMessageResult {
    id: string;
    text: string;
    channelId: string;
}

@Component({
    selector: 'app-topbar',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './topbar.component.html',
    styleUrl: './topbar.component.scss',
})
export class TopbarComponent implements OnInit, OnDestroy {
    displayName = 'Gast';
    presenceStatus: PresenceStatus = 'offline';
    avatarUrl: string | null = null;
    showAvatarImage = false;
    showUserMenu = false;
    searchTerm = '';
    showSearchResults = false;
    channelResults: SearchChannelResult[] = [];
    userResults: SearchUserResult[] = [];
    messageResults: SearchMessageResult[] = [];
    private searchableChannels: SearchChannelResult[] = [];
    private searchableUsers: SearchUserResult[] = [];
    private searchableMessages: SearchMessageResult[] = [];
    private readonly subscription = new Subscription();

    constructor(
        public readonly ui: UiStateService,
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly presenceService: PresenceService,
        private readonly channelService: ChannelService,
        private readonly messageService: MessageService,
        private readonly router: Router,
    ) {}

    ngOnInit(): void {
        this.subscription.add(
            this.authService.currentUser$
                .pipe(
                    switchMap((user) => {
                        if (!user || user.isAnonymous) {
                            this.displayName = 'Gast';
                            this.presenceStatus = 'offline';
                            this.clearAvatar();
                            return of(null);
                        }

                        this.displayName =
                            user.displayName?.trim() ||
                            user.email?.split('@')[0] ||
                            'Gast';

                        this.applyAvatar(user.photoURL);
                        this.presenceStatus = 'online';

                        // Kontinuierlich Profil-Updates laden mit Real-time Listener
                        return this.userService.getUserRealtime(user.uid).pipe(
                            catchError(() => of(null)),
                        );
                    }),
                )
                .subscribe({
                    next: (profile) => {
                        if (!profile) {
                            return;
                        }
                        const profileName = profile.displayName?.trim();
                        if (profileName) {
                            this.displayName = profileName;
                        }
                        if (profile.avatar) {
                            this.applyAvatar(profile.avatar);
                        }
                        this.presenceStatus =
                            profile.presenceStatus ?? this.presenceStatus;
                    },
                }),
        );

            this.loadSearchData();
    }

    get initials(): string {
        const name = this.displayName.trim();
        if (!name) {
            return 'G';
        }

        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }

        return parts[0][0].toUpperCase();
    }

    onAvatarError(): void {
        this.clearAvatar();
    }

    private applyAvatar(avatar?: string | null): void {
        const resolved = this.resolveAvatarUrl(avatar ?? '');

        if (!resolved) {
            this.clearAvatar();
            return;
        }

        this.avatarUrl = resolved;
        this.showAvatarImage = true;
    }

    private clearAvatar(): void {
        this.avatarUrl = null;
        this.showAvatarImage = false;
    }

    private resolveAvatarUrl(avatar: string): string {
        const trimmed = avatar.trim();

        if (!trimmed) {
            return '';
        }

        if (
            trimmed.startsWith('data:image/') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('assets/')
        ) {
            return trimmed;
        }

        return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    toggleUserMenu(): void {
        this.showUserMenu = !this.showUserMenu;
    }

    onSearchInput(value: string): void {
        this.searchTerm = value;
        const query = value.trim().toLowerCase();

        if (!query) {
            this.showSearchResults = false;
            this.channelResults = [];
            this.userResults = [];
            this.messageResults = [];
            return;
        }

        this.channelResults = this.searchableChannels
            .filter((channel) => channel.name.toLowerCase().includes(query))
            .slice(0, 5);

        this.userResults = this.searchableUsers
            .filter(
                (user) =>
                    user.name.toLowerCase().includes(query) ||
                    user.email.toLowerCase().includes(query),
            )
            .slice(0, 5);

        this.messageResults = this.searchableMessages
            .filter((message) => message.text.toLowerCase().includes(query))
            .slice(0, 5);

        this.showSearchResults =
            this.channelResults.length > 0 ||
            this.userResults.length > 0 ||
            this.messageResults.length > 0;
    }

    onSearchBlur(): void {
        setTimeout(() => {
            this.showSearchResults = false;
        }, 120);
    }

    navigateToChannel(channelId: string): void {
        this.showSearchResults = false;
        this.searchTerm = '';
        this.channelResults = [];
        this.userResults = [];
        this.messageResults = [];
        void this.router.navigate(['/app/channel', channelId]);
    }

    navigateToMessage(channelId: string): void {
        this.navigateToChannel(channelId);
    }

    closeSearchResults(): void {
        this.showSearchResults = false;
    }

    closeUserMenu(): void {
        this.showUserMenu = false;
    }

    navigateToProfile(): void {
        this.closeUserMenu();
        void this.router.navigateByUrl('/avatar-select');
    }

    async logout(): Promise<void> {
        this.closeUserMenu();
        try {
            await this.presenceService.setStatus('offline');
            await this.authService.logout();
        } finally {
            void this.router.navigateByUrl('/');
        }
    }

    get presenceLabel(): string {
        switch (this.presenceStatus) {
            case 'online':
                return 'Online';
            case 'away':
                return 'Abwesend';
            default:
                return 'Offline';
        }
    }

    private loadSearchData(): void {
        this.subscription.add(
            combineLatest([
                this.channelService.getAllChannels(),
                this.userService.getAllUsers(),
                this.messageService.getAllMessages(),
            ])
                .pipe(take(1))
                .subscribe({
                    next: ([channels, users, messages]) => {
                        const defaultChannels: SearchChannelResult[] = [
                            { id: 'taegliches', name: 'Allgemein' },
                            { id: 'entwicklerteam', name: 'Entwicklerteam' },
                        ];

                        const dbChannels = channels
                            .filter((channel) => !!channel.id)
                            .map((channel) => ({
                                id: channel.id as string,
                                name: channel.name,
                            }));

                        this.searchableChannels = [
                            ...defaultChannels,
                            ...dbChannels.filter(
                                (dbChannel) =>
                                    !defaultChannels.some(
                                        (baseChannel) =>
                                            baseChannel.id === dbChannel.id,
                                    ),
                            ),
                        ];

                        this.searchableUsers = users
                            .filter((user) => !!user.id)
                            .map((user) => ({
                                id: user.id as string,
                                name: user.displayName,
                                email: user.email,
                            }));

                        this.searchableMessages = messages
                            .filter(
                                (message) =>
                                    !!message.id &&
                                    typeof message.text === 'string' &&
                                    typeof message.channelId === 'string',
                            )
                            .map((message) => ({
                                id: message.id as string,
                                text: message.text,
                                channelId: message.channelId as string,
                            }));
                    },
                }),
        );
    }
}
