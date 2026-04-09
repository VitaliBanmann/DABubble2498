import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    HostListener,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import {
    catchError,
    combineLatest,
    debounceTime,
    distinctUntilChanged,
    filter,
    finalize,
    map,
    of,
    startWith,
    Subscription,
    Subject,
    take,
    from,
    switchMap,
    withLatestFrom,
} from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Channel, ChannelService } from '../../services/channel.service';
import { UnreadStateService } from '../../services/unread-state.service';
import { User, UserService } from '../../services/user.service';
import { UiStateService } from '../../services/ui-state.service';
import {
    createUniqueChannelId,
    getUniqueMembers,
    mapSidebarDirectMessages,
    mapSidebarChannel,
    normalizeDirectMessageLabel,
    resolveSidebarRouteState,
    SidebarChannel,
    SidebarDirectMessage,
} from './sidebar.helpers';
import {
    SearchChannelResult,
    SearchMessageResult,
    SearchUserResult,
} from '../topbar/topbar-search.util';
import { GlobalSearchService } from '../../services/global-search.service';
import { normalizeSearchToken } from '../../services/search-token.util';

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './sidebar.component.html',
    styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit, OnDestroy {
    readonly channels: SidebarChannel[] = [];
    readonly defaultChannels: SidebarChannel[] = [
        { id: 'allgemein', label: 'Allgemein' },
        { id: 'entwicklerteam', label: 'Entwicklerteam' },
    ];
    private readonly newMessageClick$ = new Subject<void>();

    readonly canStartNewMessage$ = this.authService.currentUser$.pipe(
        startWith(this.authService.getCurrentUser()),
        map((user) => !!user && !user.isAnonymous),
    );
    private readonly canonicalChannelLabels: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };
    readonly channelNameControl = new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
    });
    readonly channelDescriptionControl = new FormControl('', {
        nonNullable: true,
    });
    showCreateChannelDialog = false;
    isSaving = false;
    saveError = '';
    canCreateChannel = false;
    selectedMemberIds = new Set<string>();
    selectedMemberProfile: User | null = null;
    activeChannelId: string | null = null;
    activeDirectMessageId: string | null = null;
    private readonly subscription = new Subscription();
    currentUserId = '';
    private unreadByChannelId: Record<string, boolean> = {};
    private unreadByDirectId: Record<string, boolean> = {};
    private mentionByChannelId: Record<string, boolean> = {};
    private mentionByDirectId: Record<string, boolean> = {};
    isChannelsSectionOpen = true;
    isDirectMessagesSectionOpen = true;

    searchTerm = '';
    showSearchResults = false;
    isSearching = false;
    activeResultIndex = -1;
    channelResults: SearchChannelResult[] = [];
    userResults: SearchUserResult[] = [];
    messageResults: SearchMessageResult[] = [];
    isMobileUserMenuViewport = false;
    isSidebarSearchViewport = false;

    private readonly searchInput$ = new Subject<string>();
    private searchSubscription: Subscription | null = null;

    /** Handles toggle channels section. */
    toggleChannelsSection(): void {
        this.isChannelsSectionOpen = !this.isChannelsSectionOpen;
    }

    /** Handles toggle direct messages section. */
    toggleDirectMessagesSection(): void {
        this.isDirectMessagesSectionOpen = !this.isDirectMessagesSectionOpen;
    }
    constructor(
        private readonly authService: AuthService,
        private readonly channelService: ChannelService,
        private readonly unreadStateService: UnreadStateService,
        private readonly userService: UserService,
        private readonly router: Router,
        private readonly ui: UiStateService,
        private readonly globalSearchService: GlobalSearchService,
    ) {}

    /** Handles ng on init. */
    ngOnInit(): void {
        this.syncViewportFlags();
        this.setDefaultChannels();
        this.initAuthSnapshot();
        this.loadChannels();
        this.setupNewMessageFlow();
        this.initSearchPipeline();
        this.globalSearchService.warmCache(this.subscription);
    }

    readonly availableMembers$ = this.userService.getAllUsersRealtime().pipe(
        catchError(() => of([] as User[])),
        map((members) =>
            getUniqueMembers(members, this.currentUserId).sort((left, right) =>
                left.displayName.localeCompare(right.displayName, 'de'),
            ),
        ),
    );

    /** Handles init auth snapshot. */
    private initAuthSnapshot(): void {
        const user = this.authService.getCurrentUser();
        this.currentUserId = user?.uid ?? '';
        this.canCreateChannel = !!user && !user.isAnonymous;
        this.refreshUnreadTracking();
    }

    /** Handles refresh unread tracking. */
    private refreshUnreadTracking(): void {
        this.unreadByChannelId = {};
        this.unreadByDirectId = {};
        this.mentionByChannelId = {};
        this.mentionByDirectId = {};
    }

    /** Handles on new message click. */
    onNewMessageClick(): void {
        this.newMessageClick$.next();
    }

    /** Handles setup new message flow. */
    private setupNewMessageFlow(): void {
        this.subscription.add(
            this.newMessageClick$
                .pipe(
                    withLatestFrom(this.canStartNewMessage$),
                    filter(([, canStart]) => canStart),
                    switchMap(() => this.handleNewMessageClicked()),
                )
                .subscribe(),
        );
    }

    /** Handles handle new message clicked. */
    private handleNewMessageClicked() {
        this.ui.openNewMessage();
        this.ui.openChat();
        return from(this.router.navigate(['/app/channel/allgemein']));
    }

    private readonly routeState$ = this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        map((url) => resolveSidebarRouteState(url)),
    );

    readonly directMessages$ = combineLatest([
        this.authService.currentUser$.pipe(
            startWith(this.authService.getCurrentUser()),
        ),
        this.userService.getAllUsersRealtime().pipe(
            catchError(() => of([] as User[])),
            startWith([] as User[]),
        ),
        this.routeState$,
    ]).pipe(
        map(([user, members, routeState]) => {
            this.currentUserId = user?.uid ?? '';
            this.canCreateChannel = !!user && !user.isAnonymous;
            this.activeChannelId = routeState.activeChannelId;
            this.activeDirectMessageId = routeState.activeDirectMessageId;
            return mapSidebarDirectMessages(
                members,
                this.currentUserId,
                routeState,
                this.unreadByDirectId,
                this.mentionByDirectId,
            );
        }),
    );

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.searchSubscription?.unsubscribe();
        this.subscription.unsubscribe();
        this.searchInput$.complete();
    }

    @HostListener('window:resize')
    onWindowResize(): void {
        this.syncViewportFlags();

        if (!this.isSidebarSearchViewport) {
            this.closeSearchResults();
        }
    }

    get allResults(): Array<{ kind: 'channel' | 'user' | 'message'; item: any }> {
        return [
            ...this.channelResults.map((item) => ({ kind: 'channel' as const, item })),
            ...this.userResults.map((item) => ({ kind: 'user' as const, item })),
            ...this.messageResults.map((item) => ({ kind: 'message' as const, item })),
        ];
    }

    onSearchInput(value: string): void {
        this.searchTerm = value;
        if (!value.trim()) this.clearSearchResults();
        this.searchInput$.next(value);
    }

    onSearchFocus(): void {
        if (this.searchTerm.trim().length >= 2) {
            this.showSearchResults = true;
        }
    }

    onSearchBlur(): void {
        setTimeout(() => {
            this.showSearchResults = false;
            this.activeResultIndex = -1;
        }, 150);
    }

    onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.closeSearchResults();
            return;
        }

        if (event.key === 'Enter') {
            this.handleSearchEnter(event);
            return;
        }

        if (!this.showSearchResults) return;
        this.handleSearchArrowNavigation(event);
    }

    navigateToChannel(channelId: string): void {
        this.clearSearchResults();
        this.openChannel(channelId);
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
        this.activeResultIndex = -1;
    }

    private handleSearchEnter(event: KeyboardEvent): void {
        event.preventDefault();
        const target = this.allResults[this.activeResultIndex] ?? this.allResults[0];
        if (target) {
            this.navigateByResult(target);
            return;
        }

        this.triggerImmediateSearch();
    }

    private handleSearchArrowNavigation(event: KeyboardEvent): void {
        const total = this.allResults.length;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.activeResultIndex = Math.min(this.activeResultIndex + 1, total - 1);
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.activeResultIndex = Math.max(this.activeResultIndex - 1, -1);
        }
    }

    private navigateByResult(result: { kind: string; item: any }): void {
        if (result.kind === 'channel') return this.navigateToChannel(result.item.id);
        if (result.kind === 'user') return this.navigateToUser(result.item);
        this.navigateToMessage(result.item);
    }

    private triggerImmediateSearch(): void {
        const query = normalizeSearchToken(this.searchTerm.trim());
        if (query.length < 2) return;

        this.activeResultIndex = -1;
        this.isSearching = true;
        this.showSearchResults = true;
        this.runIndexedSearch(query);
    }

    private initSearchPipeline(): void {
        this.subscription.add(
            this.searchInput$
                .pipe(debounceTime(300), distinctUntilChanged())
                .subscribe((value) => {
                    const query = normalizeSearchToken(value.trim());

                    if (query.length < 2) {
                        this.clearSearchResults();
                        return;
                    }

                    this.activeResultIndex = -1;
                    this.isSearching = true;
                    this.showSearchResults = true;
                    this.runIndexedSearch(query);
                }),
        );
    }

    private runIndexedSearch(rawQuery: string): void {
        const token = normalizeSearchToken(rawQuery);
        if (!token) return this.clearSearchResults();

        this.searchSubscription?.unsubscribe();
        this.searchSubscription = this.globalSearchService
            .search(token)
            .subscribe((result) =>
                this.applySearchResults(result.channels, result.users, result.messages),
            );
    }

    private applySearchResults(
        channels: SearchChannelResult[],
        users: SearchUserResult[],
        messages: SearchMessageResult[],
    ): void {
        this.channelResults = channels;
        this.userResults = users;
        this.messageResults = messages;
        this.isSearching = false;
        this.showSearchResults = this.searchTerm.trim().length > 0;
    }

    private clearSearchResults(): void {
        this.showSearchResults = false;
        this.isSearching = false;
        this.activeResultIndex = -1;
        this.searchTerm = '';
        this.channelResults = [];
        this.userResults = [];
        this.messageResults = [];
    }

    private syncViewportFlags(): void {
        this.isMobileUserMenuViewport = window.innerWidth < 768;
        this.isSidebarSearchViewport = window.innerWidth <= 430;
    }

    /** Handles open create channel dialog. */
    openCreateChannelDialog(): void {
        if (!this.canCreateChannel) return;
        this.showCreateChannelDialog = true;
        this.saveError = '';
        this.channelNameControl.setValue('');
        this.channelDescriptionControl.setValue('');
        this.selectedMemberIds.clear();
        this.selectedMemberProfile = null;
    }

    /** Handles close create channel dialog. */
    closeCreateChannelDialog(): void {
        this.showCreateChannelDialog = false;
        this.isSaving = false;
    }
    /** Returns is create disabled. */
    get isCreateDisabled(): boolean {
        return this.isSaving || !this.canCreateChannel || this.channelNameControl.invalid;
    }

    /** Handles toggle member selection. */
    toggleMemberSelection(memberId: string): void {
        this.selectedMemberIds.has(memberId)
            ? this.selectedMemberIds.delete(memberId)
            : this.selectedMemberIds.add(memberId);
    }

    /** Handles open member profile. */
    openMemberProfile(member: User): void {
        this.selectedMemberProfile = member;
    }

    /** Handles close member profile. */
    closeMemberProfile(): void {
        this.selectedMemberProfile = null;
    }
    /** Handles open channel. */
    openChannel(channelId: string): void {
        this.ui.closeNewMessage();
        this.activeChannelId = channelId;
        this.activeDirectMessageId = null;
        this.ui.openChat();
        void this.router.navigate(['/app/channel', channelId], {
            queryParams: { compose: null },
            queryParamsHandling: 'merge',
        });
    }

    /** Handles open direct message. */
    openDirectMessage(member: SidebarDirectMessage): void {
        this.ui.closeNewMessage();
        const userId = member.id;
        if (!userId) return;
        this.activeChannelId = null;
        this.activeDirectMessageId = userId;
        this.ui.openChat();
        void this.router.navigate(['/app/dm', userId], this.buildDirectMessageNavigation(member));
    }

    /** Handles build direct message navigation. */
    private buildDirectMessageNavigation(member: SidebarDirectMessage) {
        return {
            queryParams: { name: normalizeDirectMessageLabel(member.label), compose: null },
            queryParamsHandling: 'merge' as const,
        };
    }
    /** Handles get initials. */
    getInitials(displayName: string): string {
        const parts = (displayName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }

    /** Handles create channel. */
    createChannel(): void {
        const draft = this.buildChannelDraft();
        if (!draft) return;
        this.saveChannelDraft(draft.id, draft.payload);
    }
    /** Handles load channels. */
    private loadChannels(): void {
        this.subscription.add(
            this.channelService
                .getAllChannels()
                .subscribe({
                    next: (channels) => this.applyChannels(channels),
                    error: () => this.setDefaultChannels(),
                }),
        );
    }

    /** Handles set default channels. */
    private setDefaultChannels(): void {
        this.channels.splice(0, this.channels.length, ...this.defaultChannels);
    }
    /** Handles build channel draft. */
    private buildChannelDraft(): { id: string; payload: Channel } | null {
        const channelName = this.getValidatedChannelName();
        if (!channelName || !this.ensureCurrentUser()) return null;
        return {
            id: createUniqueChannelId(channelName, this.channels),
            payload: this.createChannelPayload(channelName),
        };
    }

    /** Handles get validated channel name. */
    private getValidatedChannelName(): string {
        if (this.isCreateDisabled) {
            this.channelNameControl.markAsTouched();
            return '';
        }
        const channelName = this.channelNameControl.value.trim();
        if (channelName) return channelName;
        this.markInvalidChannelName();
        return '';
    }
    /** Handles mark invalid channel name. */
    private markInvalidChannelName(): void {
        this.saveError = 'Bitte gib einen gültigen Channel-Namen ein.';
        this.channelNameControl.markAsTouched();
    }

    /** Handles ensure current user. */
    private ensureCurrentUser(): boolean {
        if (this.currentUserId) return true;
        this.saveError = 'Bitte erneut anmelden und dann Channel erstellen.';
        return false;
    }
    /** Handles create channel payload. */
    private createChannelPayload(channelName: string): Channel {
        const memberIds = new Set<string>(this.selectedMemberIds);
        memberIds.add(this.currentUserId);
        const adminIds = [this.currentUserId];
        return {
            name: channelName,
            description: this.channelDescriptionControl.value.trim(),
            members: Array.from(memberIds),
            admins: adminIds,
            createdBy: this.currentUserId,
        };
    }
    /** Handles save channel draft. */
    private saveChannelDraft(channelId: string, payload: Channel): void {
        this.isSaving = true;
        this.saveError = '';
        this.subscription.add(
            this.channelService
                .createChannelWithId(channelId, payload)
                .pipe(finalize(() => (this.isSaving = false)))
                .subscribe({
                    next: () => this.handleChannelCreated(channelId, payload),
                    error: (error) => this.handleCreateChannelError(error),
                }),
        );
    }

    /** Handles handle channel created. */
    private handleChannelCreated(channelId: string, payload: Channel): void {
        this.channels.push({
            id: channelId,
            label: payload.name,
            description: payload.description,
        });
        this.sortChannels();
        this.closeCreateChannelDialog();
        this.openChannel(channelId);
    }

    /** Handles handle create channel error. */
    private handleCreateChannelError(error: unknown): void {
        console.error('Channel creation failed:', error);
        this.saveError =
            'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
    }
    /** Handles apply channels. */
    private applyChannels(channels: Channel[]): void {
        const merged = channels.reduce(
            (accumulator, channel) => this.mergeChannel(accumulator, channel),
            [...this.defaultChannels],
        );
        this.channels.splice(0, this.channels.length, ...merged);
        this.sortChannels();
        this.ensureActiveChannelVisible();
        this.refreshUnreadTracking();
    }
    /** Handles ensure active channel visible. */
    private ensureActiveChannelVisible(): void {
        const activeId = this.activeChannelId;
        if (!activeId) return;
        if (this.channels.some((channel) => channel.id === activeId)) return;

        this.subscription.add(
            this.channelService
                .getChannel(activeId)
                .pipe(take(1), catchError(() => of(null as Channel | null)))
                .subscribe((channel: Channel | null) => {
                    if (!channel?.id) return;
                    this.channels.push(
                        mapSidebarChannel(
                            channel,
                            this.canonicalChannelLabels,
                            this.unreadByChannelId,
                            this.mentionByChannelId,
                        ),
                    );
                    this.sortChannels();
                }),
        );
    }
    /** Handles merge channel. */
    private mergeChannel(
        merged: SidebarChannel[],
        channel: Channel,
    ): SidebarChannel[] {
        if (!channel.id) return merged;
        const existingIndex = merged.findIndex((item) => item.id === channel.id);
        const mapped = mapSidebarChannel(channel, this.canonicalChannelLabels, this.unreadByChannelId, this.mentionByChannelId);
        this.upsertMergedChannel(merged, existingIndex, mapped);
        return merged;
    }
    /** Handles upsert merged channel. */
    private upsertMergedChannel(
        merged: SidebarChannel[],
        index: number,
        channel: SidebarChannel,
    ): void {
        if (index >= 0) merged[index] = channel;
        else merged.push(channel);
    }

    /** Handles sort channels. */
    private sortChannels(): void {
        this.channels.sort((left, right) => {
            const leftLabel = (left.label ?? '').toString();
            const rightLabel = (right.label ?? '').toString();
            return leftLabel.localeCompare(rightLabel, 'de');
        });
    }
}
