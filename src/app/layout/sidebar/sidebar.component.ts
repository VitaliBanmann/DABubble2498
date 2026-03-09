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
} from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Channel, ChannelService } from '../../services/channel.service';
import { UnreadStateService } from '../../services/unread-state.service';
import { User, UserService } from '../../services/user.service';

interface SidebarChannel {
    id: string;
    label: string;
    description?: string;
    hasUnread?: boolean;
    hasMention?: boolean;
}

interface SidebarDirectMessage {
    id: string;
    label: string;
    isOnline: boolean;
    isSelf: boolean;
    avatar: string | null;
    hasAvatar: boolean;
    isActive: boolean;
    hasUnread?: boolean;
    hasMention?: boolean;
}

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
    private unreadSubscription: Subscription | null = null;
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
    ) {}

    ngOnInit(): void {
        this.setDefaultChannels();
        this.initAuthSnapshot();
        this.loadChannels();
    }

    readonly availableMembers$ = this.userService.getAllUsersRealtime().pipe(
        catchError(() => of([] as User[])),
        map((members) =>
            this.getUniqueMembers(members).sort((left, right) =>
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

    private readonly routeState$ = this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        map((url) => {
            const channelMatch = /\/app\/channel\/([^/?#]+)/.exec(url);
            if (channelMatch?.[1]) {
                return {
                    activeChannelId: decodeURIComponent(channelMatch[1]),
                    activeDirectMessageId: null as string | null,
                };
            }

            const directMessageMatch = /\/app\/dm\/([^/?#]+)/.exec(url);
            if (directMessageMatch?.[1]) {
                return {
                    activeChannelId: null as string | null,
                    activeDirectMessageId: decodeURIComponent(
                        directMessageMatch[1],
                    ),
                };
            }

            return {
                activeChannelId: null as string | null,
                activeDirectMessageId: null as string | null,
            };
        }),
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

            return this.getUniqueMembers(members)
                .sort((left, right) =>
                    left.displayName.localeCompare(right.displayName, 'de'),
                )
                .filter((member) => !!member.id)
                .map((member) => {
                    const id = member.id ?? '';
                    const isSelf = id === this.currentUserId;
                    const avatar = member.avatar ?? null;

                    return {
                        id,
                        label: isSelf
                            ? `${member.displayName} (Du)`
                            : member.displayName,
                        isOnline: member.presenceStatus === 'online',
                        isSelf,
                        avatar,
                        hasAvatar: !!avatar,
                        isActive: routeState.activeDirectMessageId === id,
                        hasUnread: !isSelf && !!this.unreadByDirectId[id],
                        hasMention: !isSelf && !!this.mentionByDirectId[id],
                    } satisfies SidebarDirectMessage;
                })
                .sort((left, right) => this.compareDirectMessages(left, right));
        }),
    );

    ngOnDestroy(): void {
        this.unreadSubscription?.unsubscribe();
        this.subscription.unsubscribe();
    }

    openCreateChannelDialog(): void {
        if (!this.canCreateChannel) {
            return;
        }

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
        return (
            this.isSaving ||
            !this.canCreateChannel ||
            this.channelNameControl.invalid
        );
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
        this.activeChannelId = channelId;
        this.activeDirectMessageId = null;
        void this.router.navigateByUrl(`/app/channel/${channelId}`);
    }

    openDirectMessage(member: SidebarDirectMessage): void {
        const userId = member.id;
        if (!userId) {
            return;
        }

        this.activeChannelId = null;
        this.activeDirectMessageId = userId;

        void this.router.navigate(['/app/dm', userId], {
            queryParams: {
                name: this.normalizeDirectMessageLabel(member.label),
            },
        });
    }

    getInitials(displayName: string): string {
        const parts = (displayName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) {
            return '?';
        }

        if (parts.length === 1) {
            return parts[0].charAt(0).toUpperCase();
        }

        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }

    createChannel(): void {
        const draft = this.buildChannelDraft();
        if (!draft) {
            return;
        }

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

    private getUniqueMembers(members: User[]): User[] {
        const map = new Map<string, User>();
        members.forEach((member) => this.mergeUniqueMember(map, member));
        return Array.from(map.values());
    }

    private scoreMemberRecord(member: User): number {
        let score = 0;
        if (member.id === this.currentUserId) {
            score += 100;
        }
        if (member.presenceStatus) {
            score += 10;
        }
        if (member.avatar) {
            score += 2;
        }
        return score;
    }

    private setDefaultChannels(): void {
        this.channels.splice(0, this.channels.length, ...this.defaultChannels);
    }

    private buildChannelDraft(): { id: string; payload: Channel } | null {
        const channelName = this.getValidatedChannelName();
        if (!channelName || !this.ensureCurrentUser()) {
            return null;
        }

        return {
            id: this.createUniqueChannelId(channelName),
            payload: this.createChannelPayload(channelName),
        };
    }

    private getValidatedChannelName(): string {
        if (this.isCreateDisabled) {
            this.channelNameControl.markAsTouched();
            return '';
        }

        const channelName = this.channelNameControl.value.trim();
        if (channelName) {
            return channelName;
        }

        this.markInvalidChannelName();
        return '';
    }

    private markInvalidChannelName(): void {
        this.saveError = 'Bitte gib einen gültigen Channel-Namen ein.';
        this.channelNameControl.markAsTouched();
    }

    private ensureCurrentUser(): boolean {
        if (this.currentUserId) {
            return true;
        }

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

    private startSaving(): void {
        this.isSaving = true;
        this.saveError = '';
    }

    private saveChannelDraft(channelId: string, payload: Channel): void {
        this.startSaving();
        this.subscription.add(
            this.channelService
                .createChannelWithId(channelId, payload)
                .pipe(finalize(() => this.finishSaving()))
                .subscribe({
                    next: () => this.handleChannelCreated(channelId, payload),
                    error: (error) => this.handleCreateChannelError(error),
                }),
        );
    }

    private finishSaving(): void {
        this.isSaving = false;
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
        if (!channel.id) {
            return merged;
        }

        const existingIndex = merged.findIndex(
            (item) => item.id === channel.id,
        );
        this.upsertMergedChannel(
            merged,
            existingIndex,
            this.mapSidebarChannel(channel),
        );
        return merged;
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

    private mapSidebarChannel(channel: Channel): SidebarChannel {
        return {
            id: channel.id ?? '',
            label:
                this.canonicalChannelLabels[channel.id ?? ''] ?? channel.name,
            description: channel.description,
            hasUnread: !!this.unreadByChannelId[channel.id ?? ''],
            hasMention: !!this.mentionByChannelId[channel.id ?? ''],
        };
    }

    private mergeUniqueMember(map: Map<string, User>, member: User): void {
        const key = this.getMemberKey(member);
        if (!key) {
            return;
        }

        const existing = map.get(key);
        if (
            !existing ||
            this.scoreMemberRecord(member) > this.scoreMemberRecord(existing)
        ) {
            map.set(key, member);
        }
    }

    private getMemberKey(member: User): string {
        const value = member.email || member.displayName || member.id || '';
        return value.toString().trim().toLowerCase();
    }

    private compareDirectMessages(
        left: SidebarDirectMessage,
        right: SidebarDirectMessage,
    ): number {
        if (left.isSelf) {
            return -1;
        }
        if (right.isSelf) {
            return 1;
        }
        return left.label.localeCompare(right.label, 'de');
    }

    private normalizeDirectMessageLabel(label: string): string {
        return label.replace(' (Du)', '').trim();
    }

    private sortChannels(): void {
        this.channels.sort((left, right) =>
            left.label.localeCompare(right.label, 'de'),
        );
    }

    private createUniqueChannelId(name: string): string {
        const base = this.slugify(name);
        if (!this.channels.some((channel) => channel.id === base)) {
            return base;
        }

        let index = 2;
        while (
            this.channels.some((channel) => channel.id === `${base}-${index}`)
        ) {
            index += 1;
        }

        return `${base}-${index}`;
    }

    private slugify(value: string): string {
        const normalized = value
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);

        return normalized || 'channel';
    }
}
