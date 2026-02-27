import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter, finalize, Subscription, take } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Channel, ChannelService } from '../../services/channel.service';
import { User, UserService } from '../../services/user.service';

interface SidebarChannel {
    id: string;
    label: string;
    description?: string;
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
        { id: 'taegliches', label: 'Allgemein' },
        { id: 'entwicklerteam', label: 'Entwicklerteam' },
    ];
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
    selectedMemberIds = new Set<string>();
    selectedMemberProfile: User | null = null;
    activeChannelId = 'entwicklerteam';
    private readonly subscription = new Subscription();
    private currentUserId = '';

    constructor(
        private readonly authService: AuthService,
        private readonly channelService: ChannelService,
        private readonly userService: UserService,
        private readonly router: Router,
    ) {}

    ngOnInit(): void {
        this.channels.splice(0, this.channels.length, ...this.defaultChannels);

        this.subscription.add(
            this.authService.currentUser$.subscribe((user) => {
                this.currentUserId = user?.uid ?? '';
                this.canCreateChannel = !!user && !user.isAnonymous;
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
        void this.router.navigateByUrl(`/app/channel/${channelId}`);
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
                            label: channel.name,
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
                    this.availableMembers = members.sort((left, right) =>
                        left.displayName.localeCompare(right.displayName, 'de'),
                    );
                },
            });
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
        const match = /\/app\/channel\/([^/?#]+)/.exec(url);
        if (match?.[1]) {
            this.activeChannelId = decodeURIComponent(match[1]);
        }
    }
}
