import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
    SearchChannelResult,
    SearchMessageResult,
    SearchUserResult,
} from '../topbar/topbar-search.util';
import { GlobalSearchService } from '../../services/global-search.service';
import { normalizeSearchToken } from '../../services/search-token.util';

export abstract class SidebarSearchBase {
    searchTerm = '';
    showSearchResults = false;
    isSearching = false;
    activeResultIndex = -1;
    channelResults: SearchChannelResult[] = [];
    userResults: SearchUserResult[] = [];
    messageResults: SearchMessageResult[] = [];
    isMobileUserMenuViewport = false;
    isSidebarSearchViewport = false;

    protected readonly subscription = new Subscription();
    private searchSubscription: Subscription | null = null;

    protected constructor(
        protected readonly router: Router,
        protected readonly globalSearchService: GlobalSearchService,
    ) {}

    protected abstract openChannel(channelId: string): void;

    get allResults(): Array<{ kind: 'channel' | 'user' | 'message'; item: any }> {
        return [
            ...this.channelResults.map((item) => ({ kind: 'channel' as const, item })),
            ...this.userResults.map((item) => ({ kind: 'user' as const, item })),
            ...this.messageResults.map((item) => ({ kind: 'message' as const, item })),
        ];
    }

    onSearchInput(value: string): void {
        this.searchTerm = value;
        const query = normalizeSearchToken(value.trim());
        if (query.length < 2) {
            this.clearSearchResults();
            return;
        }

        this.activeResultIndex = -1;
        this.isSearching = true;
        this.showSearchResults = true;
        this.runIndexedSearch(query);
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
        if (this.tryNavigateToDirectMessage(result)) return;
        this.navigateToChannelMessage(result);
    }

    closeSearchResults(): void {
        this.showSearchResults = false;
        this.activeResultIndex = -1;
    }

    protected syncViewportFlags(): void {
        this.isMobileUserMenuViewport = window.innerWidth < 768;
        this.isSidebarSearchViewport = window.innerWidth <= 430;
    }

    protected initSearchPipeline(): void {
        // no-op: immediate search on input keeps behavior deterministic and avoids extra state
    }

    protected destroySearchState(): void {
        this.searchSubscription?.unsubscribe();
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
        if (result.kind === 'channel') {
            this.navigateToChannel(result.item.id);
            return;
        }

        if (result.kind === 'user') {
            this.navigateToUser(result.item);
            return;
        }

        this.navigateToMessage(result.item);
    }

    private tryNavigateToDirectMessage(result: SearchMessageResult): boolean {
        if (result.kind !== 'dm' || !result.partnerUserId) return false;
        void this.router.navigate(['/app/dm', result.partnerUserId], {
            queryParams: { msg: result.id },
        });
        return true;
    }

    private navigateToChannelMessage(result: SearchMessageResult): void {
        if (!result.channelId) return;
        void this.router.navigate(['/app/channel', result.channelId], {
            queryParams: { msg: result.id },
        });
    }

    private triggerImmediateSearch(): void {
        const query = normalizeSearchToken(this.searchTerm.trim());
        if (query.length < 2) return;

        this.activeResultIndex = -1;
        this.isSearching = true;
        this.showSearchResults = true;
        this.runIndexedSearch(query);
    }

    private runIndexedSearch(rawQuery: string): void {
        const token = normalizeSearchToken(rawQuery);
        if (!token) {
            this.clearSearchResults();
            return;
        }

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
}
