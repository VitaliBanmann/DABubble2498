import { NavigationEnd, Router } from '@angular/router';
import {
    catchError,
    combineLatest,
    filter,
    finalize,
    from,
    map,
    of,
    startWith,
    switchMap,
    take,
    withLatestFrom,
    Subject,
} from 'rxjs';
import { FormControl, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Channel, ChannelService } from '../../services/channel.service';
import { User, UserService } from '../../services/user.service';
import { UiStateService } from '../../services/ui-state.service';
import {
    createUniqueChannelId,
    getUniqueMembers,
    mapSidebarChannel,
    mapSidebarDirectMessages,
    normalizeDirectMessageLabel,
    resolveSidebarRouteState,
    SidebarChannel,
    SidebarDirectMessage,
} from './sidebar.helpers';
import { GlobalSearchService } from '../../services/global-search.service';
import { SidebarSearchBase } from './sidebar-search.base';
export abstract class SidebarComponentBase extends SidebarSearchBase {
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
    currentUserId = '';
    isChannelsSectionOpen = true;
    isDirectMessagesSectionOpen = true;
    private unreadByChannelId: Record<string, boolean> = {};
    private unreadByDirectId: Record<string, boolean> = {};
    private mentionByChannelId: Record<string, boolean> = {};
    private mentionByDirectId: Record<string, boolean> = {};
    readonly availableMembers$ = this.userService.getAllUsersRealtime().pipe(
        catchError(() => of([] as User[])),
        map((members) =>
            getUniqueMembers(members, this.currentUserId).sort((left, right) =>
                left.displayName.localeCompare(right.displayName, 'de'),
            ),
        ),
    );

    private readonly routeState$ = this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        map((url) => resolveSidebarRouteState(url)),
    );

    readonly directMessages$ = combineLatest([
        this.authService.currentUser$.pipe(startWith(this.authService.getCurrentUser())),
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

    private lastDeletedChannelId: string | null = null;

    protected constructor(
        protected readonly authService: AuthService,
        protected override readonly channelService: ChannelService,
        protected override readonly userService: UserService,
        router: Router,
        protected readonly ui: UiStateService,
        globalSearchService: GlobalSearchService,
    ) {
        super(router, globalSearchService, userService, channelService);
    }
    protected initSidebarState(): void {
        this.syncViewportFlags();
        this.setDefaultChannels();
        this.initAuthSnapshot();
        this.loadChannels();
        this.setupNewMessageFlow();
        this.initSearchPipeline();
        this.globalSearchService.warmCache(this.subscription);
    }
    protected destroySidebarState(): void {
        this.destroySearchState();
        this.subscription.unsubscribe();
    }
    onNewMessageClick(): void {
        this.newMessageClick$.next();
    }
    onWindowResize(): void {
        this.syncViewportFlags();
        if (!this.isSidebarSearchViewport) {
            this.closeSearchResults();
        }
    }
    toggleChannelsSection(): void {
        this.isChannelsSectionOpen = !this.isChannelsSectionOpen;
    }
    toggleDirectMessagesSection(): void {
        this.isDirectMessagesSectionOpen = !this.isDirectMessagesSectionOpen;
    }
    openCreateChannelDialog(): void {
        if (!this.canCreateChannel) return;
        this.showCreateChannelDialog = true;
        this.saveError = '';
        this.channelNameControl.setValue('');
        this.channelDescriptionControl.setValue('');
        this.selectedMemberIds.clear();
        this.selectedMemberProfile = null;
    }
    closeCreateChannelDialog(): void {
        this.showCreateChannelDialog = false;
        this.isSaving = false;
    }
    get isCreateDisabled(): boolean {
        return this.isSaving || !this.canCreateChannel || this.channelNameControl.invalid;
    }
    toggleMemberSelection(memberId: string): void {
        if (this.selectedMemberIds.has(memberId)) {
            this.selectedMemberIds.delete(memberId);
            return;
        }
        this.selectedMemberIds.add(memberId);
    }
    openMemberProfile(member: User): void {
        this.selectedMemberProfile = member;
    }
    closeMemberProfile(): void {
        this.selectedMemberProfile = null;
    }
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
    openDirectMessage(member: SidebarDirectMessage): void {
        this.ui.closeNewMessage();
        if (!member.id) return;
        this.activeChannelId = null;
        this.activeDirectMessageId = member.id;
        this.ui.openChat();
        void this.router.navigate(['/app/dm', member.id], this.buildDirectMessageNavigation(member));
    }
    getInitials(displayName: string): string {
        const parts = (displayName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    createChannel(): void {
        const draft = this.buildChannelDraft();
        if (!draft) return;
        this.saveChannelDraft(draft.id, draft.payload);
    }
    private initAuthSnapshot(): void {
        const user = this.authService.getCurrentUser();
        this.currentUserId = user?.uid ?? '';
        this.canCreateChannel = !!user && !user.isAnonymous;
        this.refreshUnreadTracking();
    }
    private refreshUnreadTracking(): void {
        this.unreadByChannelId = {};
        this.unreadByDirectId = {};
        this.mentionByChannelId = {};
        this.mentionByDirectId = {};
    }
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
    private handleNewMessageClicked() {
        this.ui.openNewMessage();
        this.ui.openChat();
        return from(this.router.navigate(['/app/channel/allgemein']));
    }
    private buildDirectMessageNavigation(member: SidebarDirectMessage) {
        return {
            queryParams: { name: normalizeDirectMessageLabel(member.label), compose: null },
            queryParamsHandling: 'merge' as const,
        };
    }
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
    private setDefaultChannels(): void {
        this.channels.splice(0, this.channels.length, ...this.defaultChannels);
    }
    private buildChannelDraft(): { id: string; payload: Channel } | null {
        const channelName = this.getValidatedChannelName();
        if (!channelName || !this.ensureCurrentUser()) return null;
        return {
            id: createUniqueChannelId(channelName, this.channels),
            payload: this.createChannelPayload(channelName),
        };
    }
    private getValidatedChannelName(): string {
        if (this.isCreateDisabled) {
            this.channelNameControl.markAsTouched();
            return '';
        }
        const channelName = this.channelNameControl.value.trim();
        if (channelName) return channelName;
        this.saveError = 'Bitte gib einen gueltigen Channel-Namen ein.';
        this.channelNameControl.markAsTouched();
        return '';
    }
    private ensureCurrentUser(): boolean {
        if (this.currentUserId) return true;
        this.saveError = 'Bitte erneut anmelden und dann Channel erstellen.';
        return false;
    }
    private createChannelPayload(channelName: string): Channel {
        const memberIds = new Set<string>(this.selectedMemberIds);
        memberIds.add(this.currentUserId);
        return {
            name: channelName,
            description: this.channelDescriptionControl.value.trim(),
            members: Array.from(memberIds),
            admins: [this.currentUserId],
            createdBy: this.currentUserId,
        };
    }
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
    private handleCreateChannelError(error: unknown): void {
        console.error('Channel creation failed:', error);
        this.saveError = 'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
    }
    private applyChannels(channels: Channel[]): void {
        const currentIds = new Set(
            channels
                .map((channel) => (channel.id ?? '').trim())
                .filter((id) => !!id),
        );

        const merged = channels.reduce(
            (accumulator, channel) => this.mergeChannel(accumulator, channel),
            [...this.defaultChannels],
        );

        this.channels.splice(0, this.channels.length, ...merged);
        this.sortChannels();
        this.syncDeletedActiveChannelState(currentIds);
        this.ensureActiveChannelVisible();
        this.refreshUnreadTracking();
    }

    private syncDeletedActiveChannelState(currentIds: Set<string>): void {
        if (!this.activeChannelId) {
            this.lastDeletedChannelId = null;
            return;
        }

        const isDefaultChannel = this.defaultChannels.some(
            (channel) => channel.id === this.activeChannelId,
        );

        if (isDefaultChannel) {
            this.lastDeletedChannelId = null;
            return;
        }

        if (!currentIds.has(this.activeChannelId)) {
            this.lastDeletedChannelId = this.activeChannelId;
            return;
        }

        if (this.lastDeletedChannelId === this.activeChannelId) {
            this.lastDeletedChannelId = null;
        }
    }

    private ensureActiveChannelVisible(): void {
        const missingId = this.getMissingActiveChannelId();
        if (!missingId) return;
        this.subscription.add(
            this.channelService
                .getChannel(missingId)
                .pipe(take(1), catchError(() => of(null as Channel | null)))
                .subscribe((channel) => this.addActiveChannelIfFound(channel)),
        );
    }
    private mergeChannel(merged: SidebarChannel[], channel: Channel): SidebarChannel[] {
        if (!channel.id) return merged;
        const index = merged.findIndex((item) => item.id === channel.id);
        this.upsertMergedChannel(merged, index, this.mapChannelForSidebar(channel));
        return merged;
    }
    private getMissingActiveChannelId(): string | null {
        if (!this.activeChannelId) return null;

        if (this.lastDeletedChannelId === this.activeChannelId) {
            return null;
        }

        if (this.channels.some((channel) => channel.id === this.activeChannelId)) {
            return null;
        }

        return this.activeChannelId;
    }

    private addActiveChannelIfFound(channel: Channel | null): void {
        if (!channel?.id) return;

        if (this.lastDeletedChannelId === channel.id) {
            return;
        }

        if (this.activeChannelId !== channel.id) {
            return;
        }

        if (this.channels.some((item) => item.id === channel.id)) {
            return;
        }

        this.channels.push(this.mapChannelForSidebar(channel));
        this.sortChannels();
    }

    private mapChannelForSidebar(channel: Channel): SidebarChannel {
        return mapSidebarChannel(
            channel,
            this.canonicalChannelLabels,
            this.unreadByChannelId,
            this.mentionByChannelId,
        );
    }
    private upsertMergedChannel(
        merged: SidebarChannel[],
        index: number,
        channel: SidebarChannel,
    ): void {
        if (index >= 0) {
            merged[index] = channel;
            return;
        }
        merged.push(channel);
    }
    private sortChannels(): void {
        this.channels.sort((left, right) => {
            const leftLabel = (left.label ?? '').toString();
            const rightLabel = (right.label ?? '').toString();
            return leftLabel.localeCompare(rightLabel, 'de');
        });
    }
}
