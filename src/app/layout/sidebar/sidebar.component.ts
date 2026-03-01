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
            this.channels.splice(0, this.channels.length, ...this.defaultChannels);

            this.subscription.add(
                this.authService.currentUser$.subscribe((user) => {
                    this.currentUserId = user?.uid ?? '';
                    this.canCreateChannel = !!user && !user.isAnonymous;
                    this.buildDirectMessages();
                }),
            );

            this.updateActiveChannelFromUrl(this.router.url);

            this.subscription.add(
                this.router.events
                    .pipe(filter((event) => event instanceof NavigationEnd))
                    .subscribe((event) => {
                        const navigation = event as NavigationEnd;
                        this.updateActiveChannelFromUrl(navigation.urlAfterRedirects);
                    }),
            );

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

        openDirectMessage(userId: string): void {
            this.activeDirectMessageId = userId;
            void this.router.navigateByUrl(`/app/dm/${userId}`);
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
            if (this.isCreateDisabled) {
                this.channelNameControl.markAsTouched();
                return;
            }

            const rawName = this.channelNameControl.value.trim();
            const channelId = this.createUniqueChannelId(rawName);
            const memberIds = new Set<string>(this.selectedMemberIds);
            if (this.currentUserId) {
                memberIds.add(this.currentUserId);
            }

            const payload: Channel = {
                name: rawName,
                description: this.channelDescriptionControl.value.trim(),
                members: Array.from(memberIds),
                createdBy: this.currentUserId,
            };

            this.isSaving = true;
            this.saveError = '';

            this.subscription.add(
                this.channelService
                    .createChannelWithId(channelId, payload)
                    .pipe(
                        finalize(() => {
                            this.isSaving = false;
                        })
                    )
                    .subscribe({
                        next: () => {
                            this.channels.push({
                                id: channelId,
                                label: rawName,
                                description: payload.description,
                            });
                            this.sortChannels();
                            this.closeCreateChannelDialog();
                        },
                        error: (error) => {
                            console.error('Channel creation failed:', error);
                            this.saveError =
                                'Channel konnte nicht erstellt werden. Bitte erneut versuchen.';
                        },
                    })
            );
        }

        private loadChannels(): void {
            this.subscription.add(
                this.channelService.getAllChannels().subscribe({
                    next: (channels) => {
                        const merged = [...this.defaultChannels];

                        for (const channel of channels) {
                            if (!channel.id) {
                                continue;
                            }

                            const existingIndex = merged.findIndex(
                                (item) => item.id === channel.id,
                            );
                            const mapped: SidebarChannel = {
                                id: channel.id,
                                label:
                                    this.canonicalChannelLabels[channel.id] ??
                                    channel.name,
                                description: channel.description,
                            };

                            if (existingIndex >= 0) {
                                merged[existingIndex] = mapped;
                            } else {
                                merged.push(mapped);
                            }
                        }

                        this.channels.splice(0, this.channels.length, ...merged);
                        this.sortChannels();
                    },
                }),
            );
        }

        private loadMembers(): void {
            this.userService
                .getAllUsers()
                .pipe(take(1))
                .subscribe({
                    next: (members) => {
                        this.availableMembers = this.getUniqueMembers(members).sort((left, right) =>
                            left.displayName.localeCompare(right.displayName, 'de'),
                        );
                        this.buildDirectMessages();
                    },
                });
        }

        private getUniqueMembers(members: User[]): User[] {
            const map = new Map<string, User>();

            for (const member of members) {
                const key = (member.email || member.displayName || member.id || '')
                    .toString()
                    .trim()
                    .toLowerCase();

                if (!key) {
                    continue;
                }

                const existing = map.get(key);
                if (!existing) {
                    map.set(key, member);
                    continue;
                }

                const existingScore = this.scoreMemberRecord(existing);
                const candidateScore = this.scoreMemberRecord(member);

                if (candidateScore > existingScore) {
                    map.set(key, member);
                }
            }

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
                .map((member) => {
                    const isSelf = member.id === this.currentUserId;

                    return {
                        id: member.id ?? '',
                        label: isSelf ? `${member.displayName} (Du)` : member.displayName,
                        isOnline: member.presenceStatus === 'online',
                        isSelf,
                        avatar: member.avatar ?? null, // ✅ HIER dazu
                    } satisfies SidebarDirectMessage;
                })
                .sort((left, right) => {
                    if (left.isSelf) return -1;
                    if (right.isSelf) return 1;
                    return left.label.localeCompare(right.label, 'de');
                });

            this.cdr.detectChanges();
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
