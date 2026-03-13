import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
    combineLatest,
    Observable,
    Subscription,
    catchError,
    map,
    of,
    switchMap,
    asyncScheduler,
    observeOn,
    filter,
    distinctUntilChanged,
    startWith,
    debounceTime,
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
    kind: 'channel' | 'dm';
    channelId?: string;
    conversationId?: string;
    partnerUserId?: string;
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
        this.trackAuthReady();
        this.trackUserProfile();
    }

    get initials(): string {
        const name = this.displayName.trim();
        if (!name) return '';
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2)
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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
        if (!trimmed) return '';
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
        void this.router.navigate(['/app/dm', result.partnerUserId]);
        return;
    }
    if (result.channelId) {
        void this.router.navigate(['/app/channel', result.channelId]);
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
        if (!token) return this.clearSearchResults();
        this.searchSubscription?.unsubscribe();
        this.searchSubscription = this.createSearchStream(token).subscribe(
            ([channels, users, messages]) =>
                this.applySearchResults(channels, users, messages),
        );
    }

    private extractSearchQuery(value: string): string {
        const parts = value.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '';
        return normalizeSearchToken(parts[parts.length - 1]);
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
        const resolvedEmail =
            this.resolveProfileEmail(profile) || user.email || '';
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

    private createSearchStream(token: string) {
        const channelResults$ = this.buildChannelResults$(token);
        const userResults$ = this.buildUserResults$(token);
        const messageResults$ = this.buildMessageResults$(token);
        return combineLatest([channelResults$, userResults$, messageResults$]);
    }

    private readonly defaultChannelbases: SearchChannelResult[] = [
    { id: 'allgemein', name: 'Allgemein' },
    { id: 'entwicklerteam', name: 'Entwicklerteam' },
];

private buildChannelResults$(token: string) {
    return this.channelService.getAllChannels().pipe(
        map((channels) => {
            const merged = new Map<string, SearchChannelResult>(
                this.defaultChannelbases.map((ch) => [ch.id, ch]),
            );
            channels
                .filter((ch: any) => !!ch?.id)
                .forEach((ch: any) =>
                    merged.set(ch.id, { id: ch.id, name: ch.name }),
                );
            return Array.from(merged.values()).filter((ch) =>
                this.matchesSearch([ch.name], token),
            );
        }),
        catchError(() =>
            of(
                this.defaultChannelbases.filter((ch) =>
                    this.matchesSearch([ch.name], token),
                ),
            ),
        ),
    );
}

    private buildUserResults$(token: string) {
        return this.userService.getAllUsersRealtime().pipe(
            map((users) =>
                users.filter((u: any) =>
                    this.matchesSearch([u?.displayName, u?.email], token),
                ),
            ),
            catchError(() => of([])),
        );
    }

    private buildMessageResults$(token: string) {
        return combineLatest([
            this.buildChannelMessageResults$(token).pipe(
                startWith([] as any[]),
            ),
            this.buildDmMessageResults$(token).pipe(startWith([] as any[])),
        ] as [Observable<any[]>, Observable<any[]>]).pipe(
            debounceTime(200),
            map(([ch, dm]: [any[], any[]]) =>
                [...ch, ...dm]
                    .sort(
                        (a: any, b: any) =>
                            new Date(b?.timestamp ?? 0).getTime() -
                            new Date(a?.timestamp ?? 0).getTime(),
                    )
                    .slice(0, 20),
            ),
            catchError(() => of([])),
        );
    }

    private buildChannelMessageResults$(token: string) {
        return this.getSearchableChannelIds().pipe(
            distinctUntilChanged(
                (a: string[], b: string[]) => a.join(',') === b.join(','),
            ),
            switchMap((ids: string[]) => {
                if (!ids.length) return of([]);
                return combineLatest(
                    ids.map((channelId: string) =>
                        this.messageService
                            .streamLatestChannelMessages(channelId, 200)
                            .pipe(
                                map((msgs) => {
                                    console.log(
                                        '[CH]',
                                        channelId,
                                        'raw msgs:',
                                        msgs.length,
                                    );
                                    return msgs
                                        .filter((m: any) =>
                                            this.matchesSearch(
                                                [m?.text],
                                                token,
                                            ),
                                        )
                                        .map((m: any) => ({
                                            ...m,
                                            kind: 'channel' as const,
                                            channelId,
                                        }));
                                }),
                                catchError((err) => {
                                    console.error('[CH ERROR]', channelId, err);
                                    return of([] as any[]);
                                }),
                            ),
                    ),
                ).pipe(map((grouped: any[][]) => grouped.flat()));
            }),
            catchError(() => of([])),
        );
    }

    private getSearchableChannelIds(): Observable<string[]> {
        const PUBLIC_IDS = ['allgemein', 'entwicklerteam'];
        return this.channelService.getAllChannels().pipe(
            map((channels) => {
                const memberIds = channels
                    .map((ch: any) => ch?.id as string)
                    .filter(Boolean);
                return [...new Set([...PUBLIC_IDS, ...memberIds])].sort();
            }),
            catchError(() => of(PUBLIC_IDS)),
        );
    }

    private buildDmMessageResults$(token: string) {
        return this.userService.getAllUsersRealtime().pipe(
            map((users) =>
                users
                    .map((u: any) => u.id as string)
                    .filter(Boolean)
                    .sort(),
            ),
            distinctUntilChanged((a, b) => a.join(',') === b.join(',')),
            switchMap((userIds) => {
                const currentUser = this.authService.getCurrentUser();
                if (!currentUser) return of([]);
                const otherIds = userIds.filter((id) => id !== currentUser.uid);
                if (!otherIds.length) return of([]);
                return combineLatest(
                    otherIds.map((userId) =>
                        this.messageService
                            .streamLatestDirectMessages(userId, 200)
                            .pipe(
                                map((msgs) =>
                                    msgs
                                        .filter((m: any) =>
                                            this.matchesSearch(
                                                [m?.text],
                                                token,
                                            ),
                                        )
                                        .map((m: any) => ({
                                            ...m,
                                            kind: 'dm' as const,
                                            partnerUserId: userId,
                                        })),
                                ),
                                catchError(() => of([])),
                            ),
                    ),
                ).pipe(map((grouped) => grouped.flat()));
            }),
            catchError(() => of([])),
        );
    }

    private matchesSearch(parts: Array<unknown>, token: string): boolean {
        return parts.some((part) =>
            normalizeSearchToken(String(part ?? '')).includes(token),
        );
    }

    private applySearchResults(
        channels: any[],
        users: any[],
        messages: any[],
    ): void {
        console.log(
            '[SEARCH] channels:',
            channels.length,
            'users:',
            users.length,
            'messages:',
            messages,
        );
        this.channelResults = channels
            .filter((channel) => !!channel.id)
            .map((channel) => ({
                id: channel.id as string,
                name: channel.name,
            }))
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
            .filter(
                (message) =>
                    !!message.id &&
                    (message.channelId || message.conversationId),
            )
            .map((message) => ({
                id: message.id as string,
                text: message.text,
                kind: (message.kind ?? 'channel') as 'channel' | 'dm',
                channelId: message.channelId,
                conversationId: message.conversationId,
                partnerUserId: message.partnerUserId,
            }))
            .slice(0, 5);
        this.showSearchResults = !!this.extractSearchQuery(this.searchTerm);
    }
}
