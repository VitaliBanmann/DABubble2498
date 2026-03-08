    import {CommonModule} from '@angular/common';
    import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
    import {FormControl, ReactiveFormsModule, Validators} from '@angular/forms';
    import {NavigationEnd, Router} from '@angular/router';
    import {filter, finalize, Subscription, take} from 'rxjs';
    import {AuthService} from '../../services/auth.service';
    import {Channel, ChannelService} from '../../services/channel.service';
    import {User, UserService} from '../../services/user.service';

    interface SidebarChannel {
        id: string;
        label: string;
        description?: string;
    }

    interface SidebarDirectMessage {
        id: string;
        label: string;
        isOnline: boolean;
        isSelf: boolean;
        avatar?: string | null;
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
            {id: 'allgemein', label: 'Allgemein'},
            {id: 'entwicklerteam', label: 'Entwicklerteam'},
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
        availableMembers: User[] = [];
        directMessages: SidebarDirectMessage[] = [];
        selectedMemberIds = new Set<string>();
        selectedMemberProfile: User | null = null;
        activeChannelId = 'entwicklerteam';
        activeDirectMessageId = '';
        private readonly subscription = new Subscription();
        currentUserId = '';

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
            private readonly userService: UserService,
            private readonly router: Router,
            private readonly cdr: ChangeDetectorRef,
        ) {
        }

        ngOnInit(): void {
            this.setDefaultChannels();
            this.subscribeToCurrentUser();
            this.subscribeToRouteChanges();
            this.loadChannels();
            this.loadMembers();
        }

        ngOnDestroy(): void {
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
            this.activeDirectMessageId = '';
            void this.router.navigateByUrl(`/app/channel/${channelId}`);
        }

        openDirectMessage(member: SidebarDirectMessage): void {
            const userId = member.id;
            if (!userId) {
                return;
            }

            this.activeDirectMessageId = userId;
            void this.router.navigate(['/app/dm', userId], {
                queryParams: { name: this.normalizeDirectMessageLabel(member.label) },
            });
        }

        onAvatarError(member: SidebarDirectMessage): void {
            member.avatar = null;
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
                this.channelService.getAllChannels().subscribe({
                    next: (channels) => this.applyChannels(channels),
                }),
            );
        }

        private loadMembers(): void {
            this.subscription.add(
                this.userService.getAllUsersRealtime().subscribe({
                    next: (members) => {
                        this.availableMembers = this.getUniqueMembers(members).sort(
                            (left, right) =>
                                left.displayName.localeCompare(
                                    right.displayName,
                                    'de',
                                ),
                        );
                        this.buildDirectMessages();
                    },
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

        private buildDirectMessages(): void {
            this.directMessages = this.availableMembers
                .filter((member) => !!member.id)
                .map((member) => this.toDirectMessage(member))
                .sort((left, right) => this.compareDirectMessages(left, right));
            this.cdr.detectChanges();
        }

        private setDefaultChannels(): void {
            this.channels.splice(0, this.channels.length, ...this.defaultChannels);
        }

        private subscribeToCurrentUser(): void {
            this.subscription.add(
                this.authService.currentUser$.subscribe((user) => {
                    this.currentUserId = user?.uid ?? '';
                    this.canCreateChannel = !!user && !user.isAnonymous;
                    this.buildDirectMessages();
                }),
            );
        }

        private subscribeToRouteChanges(): void {
            this.updateActiveChannelFromUrl(this.router.url);
            this.subscription.add(
                this.router.events
                    .pipe(filter((event) => event instanceof NavigationEnd))
                    .subscribe((event) => this.updateFromNavigationEvent(event as NavigationEnd)),
            );
        }

        private updateFromNavigationEvent(event: NavigationEnd): void {
            this.updateActiveChannelFromUrl(event.urlAfterRedirects);
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
            return {
                name: channelName,
                description: this.channelDescriptionControl.value.trim(),
                members: Array.from(memberIds),
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
            this.cdr.detectChanges();
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
            this.cdr.detectChanges();
        }

        private handleCreateChannelError(error: unknown): void {
            console.error('Channel creation failed:', error);
            this.saveError = 'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
        }

        private applyChannels(channels: Channel[]): void {
            const merged = channels.reduce(
                (accumulator, channel) => this.mergeChannel(accumulator, channel),
                [...this.defaultChannels],
            );
            this.channels.splice(0, this.channels.length, ...merged);
            this.sortChannels();
        }

        private mergeChannel(merged: SidebarChannel[], channel: Channel): SidebarChannel[] {
            if (!channel.id) {
                return merged;
            }

            const existingIndex = merged.findIndex((item) => item.id === channel.id);
            this.upsertMergedChannel(merged, existingIndex, this.mapSidebarChannel(channel));
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
                label: this.canonicalChannelLabels[channel.id ?? ''] ?? channel.name,
                description: channel.description,
            };
        }

        private mergeUniqueMember(map: Map<string, User>, member: User): void {
            const key = this.getMemberKey(member);
            if (!key) {
                return;
            }

            const existing = map.get(key);
            if (!existing || this.scoreMemberRecord(member) > this.scoreMemberRecord(existing)) {
                map.set(key, member);
            }
        }

        private getMemberKey(member: User): string {
            const value = member.email || member.displayName || member.id || '';
            return value.toString().trim().toLowerCase();
        }

        private toDirectMessage(member: User): SidebarDirectMessage {
            const isSelf = member.id === this.currentUserId;
            return {
                id: member.id ?? '',
                label: isSelf ? `${member.displayName} (Du)` : member.displayName,
                isOnline: member.presenceStatus === 'online',
                isSelf,
                avatar: member.avatar ?? null,
            };
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
            while (this.channels.some((channel) => channel.id === `${base}-${index}`)) {
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

        private updateActiveChannelFromUrl(url: string): void {
            const channelMatch = /\/app\/channel\/([^/?#]+)/.exec(url);
            if (channelMatch?.[1]) {
                this.activeChannelId = decodeURIComponent(channelMatch[1]);
                this.activeDirectMessageId = '';
                return;
            }

            const directMessageMatch = /\/app\/dm\/([^/?#]+)/.exec(url);
            if (directMessageMatch?.[1]) {
                this.activeDirectMessageId = decodeURIComponent(directMessageMatch[1]);
            }
        }
    }
