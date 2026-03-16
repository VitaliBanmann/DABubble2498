import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import {
    catchError,
    combineLatest,
    filter,
    finalize,
    map,
    of,
    startWith,
    Subscription,
    Subject,
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

    toggleChannelsSection(): void {
        this.isChannelsSectionOpen = !this.isChannelsSectionOpen;
    }

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
    ) {}

    ngOnInit(): void {
        this.setDefaultChannels();
        this.initAuthSnapshot();
        this.loadChannels();
        this.setupNewMessageFlow();
    }

    readonly availableMembers$ = this.userService.getAllUsersRealtime().pipe(
        catchError(() => of([] as User[])),
        map((members) =>
            getUniqueMembers(members, this.currentUserId).sort((left, right) =>
                left.displayName.localeCompare(right.displayName, 'de'),
            ),
        ),
    );

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

    onNewMessageClick(): void {
        this.newMessageClick$.next();
    }

    private setupNewMessageFlow(): void {
        this.subscription.add(
            this.newMessageClick$
                .pipe(
                    withLatestFrom(this.canStartNewMessage$),
                    filter(([, canStart]) => canStart),
                    switchMap(() => {
                        this.ui.openNewMessage();
                        return from(
                            this.router.navigate(['/app/channel/allgemein']),
                        );
                    }),
                )
                .subscribe(),
        );
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

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
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
        this.selectedMemberIds.has(memberId)
            ? this.selectedMemberIds.delete(memberId)
            : this.selectedMemberIds.add(memberId);
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
        void this.router.navigate(['/app/channel', channelId], {
            queryParams: { compose: null },
            queryParamsHandling: 'merge',
        });
    }

    openDirectMessage(member: SidebarDirectMessage): void {
        this.ui.closeNewMessage();
        const userId = member.id;
        if (!userId) return;
        this.activeChannelId = null;
        this.activeDirectMessageId = userId;
        void this.router.navigate(['/app/dm', userId], this.buildDirectMessageNavigation(member));
    }

    private buildDirectMessageNavigation(member: SidebarDirectMessage) {
        return {
            queryParams: { name: normalizeDirectMessageLabel(member.label), compose: null },
            queryParamsHandling: 'merge' as const,
        };
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

    private loadChannels(): void {
        this.subscription.add(
            this.channelService
                .getAllChannels()
                .pipe(catchError(() => of([])))
                .subscribe({
                    next: (channels) => this.applyChannels(channels),
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
        this.markInvalidChannelName();
        return '';
    }

    private markInvalidChannelName(): void {
        this.saveError = 'Bitte gib einen gültigen Channel-Namen ein.';
        this.channelNameControl.markAsTouched();
    }

    private ensureCurrentUser(): boolean {
        if (this.currentUserId) return true;
        this.saveError = 'Bitte erneut anmelden und dann Channel erstellen.';
        return false;
    }

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
        this.saveError =
            'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
    }

    private applyChannels(channels: Channel[]): void {
        const merged = channels.reduce(
            (accumulator, channel) => this.mergeChannel(accumulator, channel),
            [...this.defaultChannels],
        );
        this.channels.splice(0, this.channels.length, ...merged);
        this.sortChannels();
        this.refreshUnreadTracking();
    }

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

    private upsertMergedChannel(
        merged: SidebarChannel[],
        index: number,
        channel: SidebarChannel,
    ): void {
        if (index >= 0) merged[index] = channel;
        else merged.push(channel);
    }

    private sortChannels(): void {
        this.channels.sort((left, right) =>
            left.label.localeCompare(right.label, 'de'),
        );
    }
}
