import { ChangeDetectorRef } from '@angular/core';
import {
    combineLatest,
    Observable,
    of,
    Subscription,
    catchError,
    map,
    switchMap,
    asyncScheduler,
    observeOn,
    filter,
} from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AuthFlowService } from '../../services/auth-flow.service';
import { PresenceStatus, User, UserService } from '../../services/user.service';
import { ChannelService } from '../../services/channel.service';
import {
    SearchChannelResult,
    getInitials,
    getPresenceLabel,
    mergeWithDefaults,
    resolveAvatarUrl,
    resolveProfileEmail,
} from './topbar-search.util';

export abstract class TopbarProfileBase {
    displayName = 'Gast';
    email = '';
    presenceStatus: PresenceStatus = 'offline';
    avatarUrl: string | null = null;
    showAvatarImage = false;
    showUserMenu = false;
    showProfile = false;

    protected cachedUsers: User[] = [];
    protected cachedChannels: SearchChannelResult[] = [
        { id: 'allgemein', name: 'Allgemein' },
        { id: 'entwicklerteam', name: 'Entwicklerteam' },
    ];

    private profileUid: string | null = null;
    private profileResolved = false;
    private profileFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    protected abstract get authService(): AuthService;
    protected abstract get authFlow(): AuthFlowService;
    protected abstract get userService(): UserService;
    protected abstract get channelService(): ChannelService;
    protected abstract get cdr(): ChangeDetectorRef;
    protected abstract get subscription(): Subscription;

    get initials(): string {
        return getInitials(this.displayName);
    }

    get presenceLabel(): string {
        return getPresenceLabel(this.presenceStatus);
    }

    onAvatarError(): void {
        this.clearAvatar();
    }

    toggleUserMenu(): void {
        this.showUserMenu = !this.showUserMenu;
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

    protected applyAvatar(avatar?: string | null): void {
        const resolved = resolveAvatarUrl(avatar ?? '');
        if (!resolved) {
            this.clearAvatar();
            return;
        }
        this.avatarUrl = resolved;
        this.showAvatarImage = true;
    }

    protected clearAvatar(): void {
        this.avatarUrl = null;
        this.showAvatarImage = false;
    }

    protected deferUiUpdate(update: () => void): void {
        setTimeout(() => {
            update();
            this.cdr.detectChanges();
        }, 0);
    }

    protected trackAuthReady(): void {
        this.subscription.add(
            this.authService.authReady$
                .pipe(observeOn(asyncScheduler))
                .subscribe(),
        );
    }

    protected trackUserProfile(): void {
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

    protected warmSearchCache(): void {
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

    protected applyCachedChannels(channels: any[]): void {
        this.cachedChannels = mergeWithDefaults(channels);
    }

    private loadProfileState(
        user: {
            uid: string;
            isAnonymous: boolean;
            email: string | null;
        } | null,
    ): Observable<{ user: any; profile: any } | null> {
        if (!user || user.isAnonymous) {
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
        const { profile, user } = data;
        this.deferUiUpdate(() =>
            this.applyResolvedProfile(
                ...this.resolveProfileValues(profile, user),
            ),
        );
    }

    private resolveProfileValues(
        profile: any,
        user: any,
    ): [string, string, string | null, PresenceStatus] {
        const name =
            profile.displayName?.trim() ||
            user.displayName?.trim() ||
            user.email?.split('@')[0] ||
            'Gast';
        return [
            name,
            resolveProfileEmail(profile) || user.email || '',
            profile.avatar || user.photoURL || null,
            profile.presenceStatus ?? 'online',
        ];
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
}
