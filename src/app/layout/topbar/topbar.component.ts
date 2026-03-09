import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
    combineLatest,
    Subscription,
    catchError,
    map,
    of,
    switchMap,
    take,
    asyncScheduler,
    observeOn,
    filter,
} from 'rxjs';
import { UiStateService } from '../../services/ui-state.service';
import { AuthFlowService } from '../../services/auth-flow.service';
import { AuthService } from '../../services/auth.service';
import { PresenceStatus, UserService } from '../../services/user.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { ShowProfileComponent } from '../show-profile/show-profile.component';
import { normalizeSearchToken } from '../../services/search-token.util';

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
    imports: [CommonModule, ShowProfileComponent],
    templateUrl: './topbar.component.html',
    styleUrl: './topbar.component.scss',
})
export class TopbarComponent implements OnInit, OnDestroy {
    displayName = 'Gast';
    email = '';
    presenceStatus: PresenceStatus = 'offline';
    avatarUrl: string | null = null;
    showAvatarImage = false;
    showUserMenu = false;
    showProfile = false;
    searchTerm = '';
    showSearchResults = false;
    channelResults: SearchChannelResult[] = [];
    userResults: SearchUserResult[] = [];
    messageResults: SearchMessageResult[] = [];
    private readonly subscription = new Subscription();
    private searchSubscription: Subscription | null = null;
    private profileUid: string | null = null;
    private profileResolved = false;
    private profileFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        public readonly ui: UiStateService,
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly channelService: ChannelService,
        private readonly messageService: MessageService,
        private readonly router: Router,
        private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.subscription.add(
            this.authService.authReady$
                .pipe(observeOn(asyncScheduler))
                .subscribe((ready) => {
                    if (!ready) {
                        return;
                    }
                }),
        );

        this.subscription.add(
            combineLatest([
                this.authService.authReady$,
                this.authService.currentUser$,
            ])
                .pipe(
                    observeOn(asyncScheduler),
                    filter(([ready]) => ready),
                    switchMap(([, user]) => {
                        if (!user || user.isAnonymous) {
                            this.clearSearchResults();
                            this.clearProfileFallback();
                            return of(null);
                        }

                        this.beginProfileFallback(user.uid, user);

                        return this.userService
                            .getUserProfileRealtime(user.uid, user.email ?? '')
                            .pipe(
                                catchError(() => of(null)),
                                map((profile) => ({ user, profile })),
                            );
                    }),
                )
                .subscribe({
                    next: (data) => {
                        if (!data) {
                            return;
                        }

                        const { user, profile } = data;

                        if (profile) {
                            const resolvedName =
                                profile.displayName?.trim() ||
                                user.displayName?.trim() ||
                                user.email?.split('@')[0] ||
                                'Gast';

                            const resolvedEmail =
                                this.resolveProfileEmail(profile) ||
                                user.email ||
                                '';

                            const resolvedAvatar =
                                profile.avatar || user.photoURL || null;
                            const resolvedPresence =
                                profile.presenceStatus ?? 'online';

                            this.deferUiUpdate(() => {
                                this.profileResolved = true;
                                this.clearProfileFallback();
                                this.displayName = resolvedName;
                                this.email = resolvedEmail;
                                this.applyAvatar(resolvedAvatar);
                                this.presenceStatus = resolvedPresence;
                            });
                        }
                    },
                }),
        );
    }

    get initials(): string {
        const name = this.displayName.trim();
        if (!name) {
            return '';
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

    private deferUiUpdate(update: () => void): void {
    setTimeout(() => {
        update();
        this.cdr.detectChanges();
    }, 0);
}

    private resolveProfileEmail(profile: Record<string, unknown>): string {
        const candidates = [
            profile['email'],
            profile['mail'],
            profile['emailAddress'],
            profile['eMail'],
        ];

        const firstEmail = candidates.find(
            (value) => typeof value === 'string' && value.trim().length > 0,
        );

        return typeof firstEmail === 'string' ? firstEmail.trim() : '';
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
        this.searchSubscription?.unsubscribe();
        this.subscription.unsubscribe();
    }

    toggleUserMenu(): void {
        this.showUserMenu = !this.showUserMenu;
    }

    onSearchInput(value: string): void {
        this.searchTerm = value;
        const query = value.trim().toLowerCase();

        if (!query) {
            this.clearSearchResults();
            return;
        }

        this.runIndexedSearch(query);
    }

    onSearchBlur(): void {
        setTimeout(() => {
            this.showSearchResults = false;
        }, 120);
    }

    navigateToChannel(channelId: string): void {
        this.clearSearchResults();
        void this.router.navigate(['/app/channel', channelId]);
    }

    navigateToUser(user: SearchUserResult): void {
        this.clearSearchResults();
        void this.router.navigate(['/app/dm', user.id], {
            queryParams: { name: user.name },
        });
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
        this.showProfile = true;
    }

    closeProfile(): void {
        this.showProfile = false;
    }

    async logout(): Promise<void> {
        this.closeUserMenu();
        await this.authFlow.logoutToLogin();
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

    private runIndexedSearch(rawQuery: string): void {
        const token = normalizeSearchToken(rawQuery);
        if (!token) {
            this.clearSearchResults();
            return;
        }

        this.searchSubscription?.unsubscribe();
        this.searchSubscription = combineLatest([
            this.channelService.searchChannelsByToken(token).pipe(catchError(() => of([]))),
            this.userService.searchUsersByToken(token).pipe(catchError(() => of([]))),
            this.messageService.searchMessagesByToken(token).pipe(catchError(() => of([]))),
        ])
            .pipe(take(1))
            .subscribe(([channels, users, messages]) => {
                this.channelResults = channels
                    .filter((channel) => !!channel.id)
                    .map((channel) => ({ id: channel.id as string, name: channel.name }))
                    .slice(0, 5);

                this.userResults = users
                    .filter((user) => !!user.id)
                    .map((user) => ({
                        id: user.id as string,
                        name: user.displayName,
                        email: user.email,
                    }))
                    .slice(0, 5);

                this.messageResults = messages
                    .filter((message) => !!message.id && typeof message.channelId === 'string')
                    .map((message) => ({
                        id: message.id as string,
                        text: message.text,
                        channelId: message.channelId as string,
                    }))
                    .slice(0, 5);

                this.showSearchResults =
                    this.channelResults.length > 0 ||
                    this.userResults.length > 0 ||
                    this.messageResults.length > 0;
            });
    }

    private clearSearchResults(): void {
        this.showSearchResults = false;
        this.searchTerm = '';
        this.channelResults = [];
        this.userResults = [];
        this.messageResults = [];
    }

    private beginProfileFallback(
        uid: string,
        user: {
            displayName?: string | null;
            email?: string | null;
            photoURL?: string | null;
        },
    ): void {
        if (this.profileUid !== uid) {
            this.profileUid = uid;
            this.profileResolved = false;
        }

        this.clearProfileFallback();
        this.profileFallbackTimer = setTimeout(() => {
            if (this.profileUid !== uid || this.profileResolved) {
                return;
            }

            this.deferUiUpdate(() => {
                this.displayName =
                    user.displayName?.trim() ||
                    user.email?.split('@')[0] ||
                    'Gast';
                this.email = user.email ?? '';
                this.applyAvatar(user.photoURL);
                this.presenceStatus = 'online';
            });
        }, 1200);
    }

    private clearProfileFallback(): void {
        if (this.profileFallbackTimer) {
            clearTimeout(this.profileFallbackTimer);
            this.profileFallbackTimer = null;
        }
    }
}
