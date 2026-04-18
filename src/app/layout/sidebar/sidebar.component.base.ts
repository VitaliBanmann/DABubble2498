import { Router } from '@angular/router';
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
import { Channel } from '../../services/channel.service';
import { User, UserService } from '../../services/user.service';
import { UiStateService } from '../../services/ui-state.service';
import {
    createUniqueChannelId,
    getUniqueMembers,
    mapSidebarDirectMessages,
    normalizeDirectMessageLabel,
    SidebarDirectMessage,
} from './sidebar.helpers';
import { GlobalSearchService } from '../../services/global-search.service';
import { SidebarChannelSyncBase } from './sidebar-channel-sync.base';
import { ChannelService } from '../../services/channel.service';

export abstract class SidebarComponentBase extends SidebarChannelSyncBase {
    private readonly newMessageClick$ = new Subject<void>();

    readonly canStartNewMessage$ = this.authService.currentUser$.pipe(
        startWith(this.authService.getCurrentUser()),
        map((user) => !!user && !user.isAnonymous),
    );

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
    channelNameError = '';
    canCreateChannel = false;
    selectedMemberIds = new Set<string>();
    selectedMemberProfile: User | null = null;
    activeChannelId: string | null = null;
    activeDirectMessageId: string | null = null;
    currentUserId = '';
    isChannelsSectionOpen = true;
    isDirectMessagesSectionOpen = true;

    readonly availableMembers$ = this.userService.getAllUsersRealtime().pipe(
        catchError(() => of([] as User[])),
        map((members) =>
            getUniqueMembers(members, this.currentUserId).sort((left, right) =>
                left.displayName.localeCompare(right.displayName, 'de'),
            ),
        ),
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

    protected constructor(
        protected readonly authService: AuthService,
        channelService: ChannelService,
        userService: UserService,
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
        if (!this.canCreateChannel || this.isSaving) return;

        this.showCreateChannelDialog = true;
        this.resetCreateChannelFormState();
    }

    closeCreateChannelDialog(): void {
        if (this.isSaving) return;
        this.forceCloseCreateChannelDialog();
    }

    private forceCloseCreateChannelDialog(): void {
        this.showCreateChannelDialog = false;
        this.isSaving = false;
        this.channelNameError = '';
        this.saveError = '';
    }

    get isCreateDisabled(): boolean {
        return this.isSaving || !this.canCreateChannel || this.channelNameControl.invalid;
    }

    get isCreateOverlayReadonly(): boolean {
        return this.isSaving;
    }

    toggleMemberSelection(memberId: string): void {
        if (this.isSaving) return;

        if (this.selectedMemberIds.has(memberId)) {
            this.selectedMemberIds.delete(memberId);
            return;
        }

        this.selectedMemberIds.add(memberId);
    }

    openMemberProfile(member: User): void {
        if (this.isSaving) return;
        this.selectedMemberProfile = member;
    }

    closeMemberProfile(): void {
        if (this.isSaving) return;
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
        if (this.isSaving) return;

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

    private buildChannelDraft(): { id: string; payload: Channel } | null {
        const channelName = this.getValidatedChannelName();
        if (!channelName || !this.ensureCurrentUser()) return null;

        return {
            id: createUniqueChannelId(channelName, this.channels),
            payload: this.createChannelPayload(channelName),
        };
    }

    private getValidatedChannelName(): string {
        this.channelNameError = '';
        this.saveError = '';

        if (this.isCreateDisabled && !this.isSaving) {
            this.channelNameControl.markAsTouched();
            return '';
        }

        const channelName = this.channelNameControl.value.trim();
        if (channelName) return channelName;

        this.channelNameError = 'Bitte gib einen gueltigen Channel-Namen ein.';
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
        this.channelNameError = '';

        this.disableCreateChannelControls();

        this.subscription.add(
            this.channelService
                .channelNameExists(payload.name)
                .pipe(
                    take(1),
                    switchMap((exists) => {
                        if (exists) {
                            this.channelNameError =
                                `Der Channel „${payload.name}“ existiert bereits.`;
                            return of(null);
                        }

                        return this.channelService.createChannelWithId(channelId, payload);
                    }),
                    finalize(() => {
                        this.isSaving = false;
                        this.enableCreateChannelControls();
                    }),
                )
                .subscribe({
                    next: (createdChannelId) => {
                        if (!createdChannelId) return;
                        this.handleChannelCreated(createdChannelId, payload);
                    },
                    error: (error) =>
                        this.handleCreateChannelError(error, payload.name),
                }),
        );
    }

    private handleChannelCreated(channelId: string, payload: Channel): void {
        this.upsertSidebarChannel({
            ...payload,
            id: channelId,
        });

        if (this.hasSidebarChannel(channelId)) {
            this.forceCloseCreateChannelDialog();
            this.openChannel(channelId);
        }
    }

    private handleCreateChannelError(error: unknown, channelName: string): void {
        console.error('Channel creation failed:', error);
        if (this.isChannelNameConflictError(error)) {
            this.channelNameError =
                `Der Channel „${channelName}“ existiert bereits.`;
            this.saveError = '';
            return;
        }

        this.saveError = 'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
    }

    private isChannelNameConflictError(error: unknown): boolean {
        const code = this.extractFirebaseErrorCode(error);
        return (
            code === 'already-exists'
            || code === 'channel/already-exists'
            || code === 'permission-denied'
            || code === 'failed-precondition'
        );
    }

    private extractFirebaseErrorCode(error: unknown): string {
        if (!error || typeof error !== 'object') return '';
        const raw = String((error as { code?: unknown }).code ?? '').trim();
        if (!raw) return '';
        const normalized = raw.toLowerCase();
        return normalized.includes('/') ? normalized.split('/').pop() ?? '' : normalized;
    }

    private resetCreateChannelFormState(): void {
        this.saveError = '';
        this.channelNameError = '';
        this.channelNameControl.setValue('');
        this.channelDescriptionControl.setValue('');
        this.channelNameControl.enable({ emitEvent: false });
        this.channelDescriptionControl.enable({ emitEvent: false });
        this.selectedMemberIds.clear();
        this.selectedMemberProfile = null;
    }

    private disableCreateChannelControls(): void {
        this.channelNameControl.disable({ emitEvent: false });
        this.channelDescriptionControl.disable({ emitEvent: false });
    }

    private enableCreateChannelControls(): void {
        this.channelNameControl.enable({ emitEvent: false });
        this.channelDescriptionControl.enable({ emitEvent: false });
    }
}
