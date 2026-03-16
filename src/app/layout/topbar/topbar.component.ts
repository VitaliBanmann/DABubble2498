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
    asyncScheduler,
    observeOn,
    filter,
} from 'rxjs';
import { UiStateService } from '../../services/ui-state.service';
import { AuthFlowService } from '../../services/auth-flow.service';
import { AuthService } from '../../services/auth.service';
import { PresenceStatus, User, UserService } from '../../services/user.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { ShowProfileComponent } from '../show-profile/show-profile.component';
import { normalizeSearchToken } from '../../services/search-token.util';
import {
    SearchChannelResult,
    SearchMessageResult,
    SearchUserResult,
    createSearchStream,
    getInitials,
    getPresenceLabel,
    mapSearchResults,
    mergeWithDefaults,
    resolveAvatarUrl,
    resolveProfileEmail,
} from './topbar-search.util';

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
    private cachedUsers: User[] = [];
    private cachedChannels: SearchChannelResult[] = [
        { id: 'allgemein', name: 'Allgemein' },
        { id: 'entwicklerteam', name: 'Entwicklerteam' },
    ];

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
        this.trackAuthReady();
        this.trackUserProfile();
        this.warmSearchCache();
    }

    get initials(): string {
        return getInitials(this.displayName);
    }

    onAvatarError(): void {
        this.clearAvatar();
    }

    private applyAvatar(avatar?: string | null): void {
        const resolved = resolveAvatarUrl(avatar ?? '');
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

    ngOnDestroy(): void {
        this.searchSubscription?.unsubscribe();
        this.subscription.unsubscribe();
    }

    toggleUserMenu(): void {
        this.showUserMenu = !this.showUserMenu;
    }

    onSearchInput(value: string): void {
        this.searchTerm = value;
        const query = this.extractSearchQuery(value);
        if (query.length < 2) {
            this.showSearchResults = false;
            this.channelResults = [];
            this.userResults = [];
            this.messageResults = [];
            return;
        }
        this.showSearchResults = true;
        this.runIndexedSearch(query);
    }

    onSearchEnter(event: Event): void {
        event.preventDefault();
        if (this.channelResults[0])
            return this.navigateToChannel(this.channelResults[0].id);
        if (this.userResults[0])
            return this.navigateToUser(this.userResults[0]);
        if (this.messageResults[0])
            return this.navigateToMessage(this.messageResults[0]);
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

    navigateToMessage(result: SearchMessageResult): void {
        this.clearSearchResults();
        if (result.kind === 'dm' && result.partnerUserId) {
            void this.router.navigate(['/app/dm', result.partnerUserId], {
                queryParams: { msg: result.id },
            });
            return;
        }
        if (result.channelId) {
            void this.router.navigate(['/app/channel', result.channelId], {
                queryParams: { msg: result.id },
            });
        }
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
        return getPresenceLabel(this.presenceStatus);
    }

    private runIndexedSearch(rawQuery: string): void {
        const token = normalizeSearchToken(rawQuery);
        if (!token) return this.clearSearchResults();
        this.searchSubscription?.unsubscribe();
        this.searchSubscription = createSearchStream(token, {
            authService: this.authService,
            channelService: this.channelService,
            messageService: this.messageService,
            userService: this.userService,
            cachedChannels: this.cachedChannels,
            cachedUsers: this.cachedUsers,
        }).subscribe(
            ([channels, users, messages]) =>
                this.applySearchResults(channels, users, messages),
        );
    }

    private extractSearchQuery(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return '';
        return normalizeSearchToken(trimmed);
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
        if (this.profileUid !== uid) this.resetProfileResolution(uid);
        this.clearProfileFallback();
        this.profileFallbackTimer = setTimeout(
            () => this.applyProfileFallback(uid, user),
            1200,
        );
    }

    private clearProfileFallback(): void {
        if (this.profileFallbackTimer) {
            clearTimeout(this.profileFallbackTimer);
            this.profileFallbackTimer = null;
        }
    }

    private resetProfileResolution(uid: string): void {
        this.profileUid = uid;
        this.profileResolved = false;
    }

    private applyProfileFallback(
        uid: string,
        user: {
            displayName?: string | null;
            email?: string | null;
            photoURL?: string | null;
        },
    ): void {
        if (this.profileUid !== uid || this.profileResolved) return;
        this.deferUiUpdate(() => {
            this.displayName =
                user.displayName?.trim() || user.email?.split('@')[0] || 'Gast';
            this.email = user.email ?? '';
            this.applyAvatar(user.photoURL);
            this.presenceStatus = 'online';
        });
    }

    private trackAuthReady(): void {
        this.subscription.add(
            this.authService.authReady$
                .pipe(observeOn(asyncScheduler))
                .subscribe(),
        );
    }

    private trackUserProfile(): void {
        this.subscription.add(
            combineLatest([
                this.authService.authReady$,
                this.authService.currentUser$,
            ])
                .pipe(
                    observeOn(asyncScheduler),
                    filter(([ready]) => ready),
                    switchMap(([, user]) => this.loadProfileState(user)),
                )
                .subscribe({ next: (data) => this.applyProfileState(data) }),
        );
    }

    private loadProfileState(
        user: {
            uid: string;
            isAnonymous: boolean;
            email: string | null;
        } | null,
    ) {
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
    }

    private applyProfileState(data: { user: any; profile: any } | null): void {
        if (!data?.profile) return;
        const profile = data.profile;
        const user = data.user;
        const resolvedName =
            profile.displayName?.trim() ||
            user.displayName?.trim() ||
            user.email?.split('@')[0] ||
            'Gast';
        const resolvedEmail = resolveProfileEmail(profile) || user.email || '';
        const resolvedAvatar = profile.avatar || user.photoURL || null;
        const resolvedPresence = profile.presenceStatus ?? 'online';
        this.deferUiUpdate(() =>
            this.applyResolvedProfile(
                resolvedName,
                resolvedEmail,
                resolvedAvatar,
                resolvedPresence,
            ),
        );
    }

    private applyResolvedProfile(
        name: string,
        email: string,
        avatar: string | null,
        presence: PresenceStatus,
    ): void {
        this.profileResolved = true;
        this.clearProfileFallback();
        this.displayName = name;
        this.email = email;
        this.applyAvatar(avatar);
        this.presenceStatus = presence;
    }

    private warmSearchCache(): void {
        this.subscription.add(
            this.userService
                .getAllUsersRealtime()
                .pipe(catchError(() => of([] as User[])))
                .subscribe((users) => {
                    this.cachedUsers = users;
                }),
        );
        this.subscription.add(
            this.channelService
                .getAllChannels()
                .pipe(catchError(() => of([])))
                .subscribe((channels) => this.applyCachedChannels(channels)),
        );
    }

    private applyCachedChannels(channels: any[]): void {
        this.cachedChannels = mergeWithDefaults(channels);
    }

    private applySearchResults(
        channels: any[],
        users: any[],
        messages: any[],
    ): void {
        const mapped = mapSearchResults(channels, users, messages);
        this.channelResults = mapped.channels;
        this.userResults = mapped.users;
        this.messageResults = mapped.messages;
        this.showSearchResults = !!this.extractSearchQuery(this.searchTerm);
    }
}
