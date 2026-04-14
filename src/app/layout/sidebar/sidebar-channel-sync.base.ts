import { NavigationEnd, Router } from '@angular/router';
import { catchError, filter, map, of, startWith, take } from 'rxjs';
import { Channel, ChannelService } from '../../services/channel.service';
import { UserService } from '../../services/user.service';
import {
    mapSidebarChannel,
    resolveSidebarRouteState,
    SidebarChannel,
} from './sidebar.helpers';
import { GlobalSearchService } from '../../services/global-search.service';
import { SidebarSearchBase } from './sidebar-search.base';

export abstract class SidebarChannelSyncBase extends SidebarSearchBase {
    readonly channels: SidebarChannel[] = [];
    readonly defaultChannels: SidebarChannel[] = [
        { id: 'allgemein', label: 'Allgemein' },
        { id: 'entwicklerteam', label: 'Entwicklerteam' },
    ];

    protected readonly routeState$ = this.router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        map((url) => resolveSidebarRouteState(url)),
    );

    protected unreadByChannelId: Record<string, boolean> = {};
    protected unreadByDirectId: Record<string, boolean> = {};
    protected mentionByChannelId: Record<string, boolean> = {};
    protected mentionByDirectId: Record<string, boolean> = {};

    private readonly canonicalChannelLabels: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };

    private lastDeletedChannelId: string | null = null;
    protected abstract activeChannelId: string | null;

    protected constructor(
        router: Router,
        globalSearchService: GlobalSearchService,
        userService: UserService,
        channelService: ChannelService,
    ) {
        super(router, globalSearchService, userService, channelService);
    }

    protected refreshUnreadTracking(): void {
        this.unreadByChannelId = {};
        this.unreadByDirectId = {};
        this.mentionByChannelId = {};
        this.mentionByDirectId = {};
    }

    protected loadChannels(): void {
        this.subscription.add(
            this.channelService
                .getAllChannels()
                .subscribe({
                    next: (channels) => this.applyChannels(channels),
                    error: () => this.setDefaultChannels(),
                }),
        );
    }

    protected setDefaultChannels(): void {
        this.channels.splice(0, this.channels.length, ...this.defaultChannels);
    }

    protected applyChannels(channels: Channel[]): void {
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
        if (this.lastDeletedChannelId === channel.id) return;
        if (this.activeChannelId !== channel.id) return;
        if (this.channels.some((item) => item.id === channel.id)) return;

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

    protected sortChannels(): void {
        this.channels.sort((left, right) => {
            const leftLabel = (left.label ?? '').toString();
            const rightLabel = (right.label ?? '').toString();
            return leftLabel.localeCompare(rightLabel, 'de');
        });
    }
}
