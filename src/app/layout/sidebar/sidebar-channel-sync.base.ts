import { NavigationEnd, Router } from '@angular/router';
import {
    catchError,
    filter,
    map,
    of,
    retry,
    startWith,
    take,
    timer,
} from 'rxjs';
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

    private readonly sidebarChannelCache = new Map<string, SidebarChannel>();
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
        this.seedDefaultChannelsIntoCache();
        this.renderChannelsFromCache();

        this.subscription.add(
            this.channelService
                .getAllChannelsOnce()
                .pipe(take(1))
                .subscribe({
                    next: (channels) => this.applyChannels(channels),
                    error: (error) => this.handleChannelLoadError(error),
                }),
        );

        this.subscription.add(
            this.channelService
                .getAllChannels()
                .pipe(
                    retry({
                        count: 10,
                        delay: (_error, retryCount) =>
                            timer(Math.min(500 * 2 ** (retryCount - 1), 4000)),
                    }),
                )
                .subscribe({
                    next: (channels) => this.applyChannels(channels),
                    error: (error) => this.handleChannelLoadError(error),
                }),
        );
    }

    protected setDefaultChannels(): void {
        this.seedDefaultChannelsIntoCache();
        this.renderChannelsFromCache();
    }

    protected applyChannels(channels: Channel[]): void {
        const currentIds = this.collectCurrentChannelIds(channels);
        const merged = this.mergeWithDefaultChannels(channels);

        this.seedDefaultChannelsIntoCache();

        merged.forEach((channel) => {
            this.sidebarChannelCache.set(channel.id, channel);
        });

        this.removeDeletedChannelFromCacheIfNeeded(currentIds);
        this.syncDeletedActiveChannelState(currentIds);
        this.ensureActiveChannelVisible();
        this.renderChannelsFromCache();
    }

    protected upsertSidebarChannel(channel: Channel): void {
        const mapped = this.mapChannelForSidebar(channel);
        this.sidebarChannelCache.set(mapped.id, mapped);
        this.renderChannelsFromCache();
    }

    protected hasSidebarChannel(channelId: string): boolean {
        return this.channels.some((channel) => channel.id === channelId);
    }

    private handleChannelLoadError(error: unknown): void {
        console.error('[SIDEBAR CHANNEL LOAD ERROR]', error);

        if (!this.channels.length) {
            this.seedDefaultChannelsIntoCache();
            this.renderChannelsFromCache();
        }

        this.ensureActiveChannelVisible();
    }

    private syncDeletedActiveChannelState(currentIds: Set<string>): void {
        if (!this.activeChannelId) return void this.clearDeletedChannelMarker();
        if (this.isDefaultActiveChannel()) return void this.clearDeletedChannelMarker();
        if (!currentIds.has(this.activeChannelId)) return void this.markActiveChannelDeleted();
        if (this.lastDeletedChannelId === this.activeChannelId) this.clearDeletedChannelMarker();
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

        this.sidebarChannelCache.set(channel.id, this.mapChannelForSidebar(channel));
        this.renderChannelsFromCache();
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
            const leftIsDefault = this.isDefaultChannelId(left.id);
            const rightIsDefault = this.isDefaultChannelId(right.id);

            if (leftIsDefault && !rightIsDefault) return -1;
            if (!leftIsDefault && rightIsDefault) return 1;

            const leftLabel = (left.label ?? '').toString();
            const rightLabel = (right.label ?? '').toString();
            return leftLabel.localeCompare(rightLabel, 'de');
        });
    }

    private renderChannelsFromCache(): void {
        const nextChannels = Array.from(this.sidebarChannelCache.values());
        this.channels.splice(0, this.channels.length, ...nextChannels);
        this.sortChannels();
    }

    private seedDefaultChannelsIntoCache(): void {
        this.defaultChannels.forEach((channel) => {
            this.sidebarChannelCache.set(channel.id, channel);
        });
    }

    private collectCurrentChannelIds(channels: Channel[]): Set<string> {
        return new Set(
            channels
                .map((channel) => (channel.id ?? '').trim())
                .filter((id) => !!id),
        );
    }

    private mergeWithDefaultChannels(channels: Channel[]): SidebarChannel[] {
        return channels.reduce(
            (accumulator, channel) => this.mergeChannel(accumulator, channel),
            [...this.defaultChannels],
        );
    }

    private removeDeletedChannelFromCacheIfNeeded(currentIds: Set<string>): void {
        if (!this.lastDeletedChannelId) return;
        if (currentIds.has(this.lastDeletedChannelId)) return;

        this.sidebarChannelCache.delete(this.lastDeletedChannelId);
    }

    private clearDeletedChannelMarker(): void {
        this.lastDeletedChannelId = null;
    }

    private isDefaultActiveChannel(): boolean {
        return this.defaultChannels.some((channel) => channel.id === this.activeChannelId);
    }

    private isDefaultChannelId(channelId: string): boolean {
        return this.defaultChannels.some((channel) => channel.id === channelId);
    }

    private markActiveChannelDeleted(): void {
        this.lastDeletedChannelId = this.activeChannelId;
    }
}
