import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
    Subject,
    Subscription,
    debounceTime,
    distinctUntilChanged,
} from 'rxjs';
import { UiStateService } from '../../services/ui-state.service';
import { AuthFlowService } from '../../services/auth-flow.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { ShowProfileComponent } from '../show-profile/show-profile.component';
import { normalizeSearchToken } from '../../services/search-token.util';
import {
    SearchChannelResult,
    SearchMessageResult,
    SearchUserResult,
    createSearchStream,
    mapSearchResults,
} from './topbar-search.util';
import { TopbarProfileBase } from './topbar-profile.base';

@Component({
    selector: 'app-topbar',
    standalone: true,
    imports: [CommonModule, ShowProfileComponent],
    templateUrl: './topbar.component.html',
    styleUrl: './topbar.component.scss',
})
export class TopbarComponent extends TopbarProfileBase implements OnInit, OnDestroy {
    @ViewChild('mobileSearchInputRef')
    private mobileSearchInputRef?: ElementRef<HTMLInputElement>;

    searchTerm = '';
    showSearchResults = false;
    isSearching = false;
    activeResultIndex = -1;
    channelResults: SearchChannelResult[] = [];
    userResults: SearchUserResult[] = [];
    messageResults: SearchMessageResult[] = [];
    showMobileSearchOverlay = false;
    isMobileUserMenuViewport = false;

    private readonly searchInput$ = new Subject<string>();
    private readonly _subscription = new Subscription();
    private searchSubscription: Subscription | null = null;

    /** Returns subscription. */
    protected get subscription(): Subscription {
        return this._subscription;
    }

    /** Returns auth service. */
    protected get authService(): AuthService {
        return this._authService;
    }

    /** Returns auth flow. */
    protected get authFlow(): AuthFlowService {
        return this._authFlow;
    }

    /** Returns user service. */
    protected get userService(): UserService {
        return this._userService;
    }

    /** Returns channel service. */
    protected get channelService(): ChannelService {
        return this._channelService;
    }

    /** Returns cdr. */
    protected get cdr(): ChangeDetectorRef {
        return this._cdr;
    }

    constructor(
        public readonly ui: UiStateService,
        private readonly _authFlow: AuthFlowService,
        private readonly _authService: AuthService,
        private readonly _userService: UserService,
        private readonly _channelService: ChannelService,
        private readonly messageService: MessageService,
        private readonly router: Router,
        private readonly _cdr: ChangeDetectorRef,
    ) {
        super();
    }

    /** Handles ng on init. */
    ngOnInit(): void {
        this.syncViewportFlags();
        this.trackAuthReady();
        this.trackUserProfile();
        this.warmSearchCache();
        this.initSearchPipeline();
    }

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.searchSubscription?.unsubscribe();
        this._subscription.unsubscribe();
        this.searchInput$.complete();
    }

    /** Handles browser resize. */
    @HostListener('window:resize')
    onWindowResize(): void {
        this.syncViewportFlags();
        if (!this.isSmallViewport() && this.showMobileSearchOverlay) {
            this.closeMobileSearchOverlay();
        }

        if (!this.isMobileUserMenuViewport && this.showUserMenu) {
            this.closeUserMenu();
        }
    }

    /** Opens user menu from avatar on mobile viewport. */
    onAvatarMenuClick(): void {
        if (!this.isMobileUserMenuViewport) return;
        this.toggleUserMenu();
    }

    /** Handles on mobile back. */
    onMobileBack(): void {
        this.ui.goBackToSidebar();
    }

    /** Opens mobile search overlay. */
    openMobileSearchOverlay(): void {
        if (!this.isSmallViewport()) return;

        this.showMobileSearchOverlay = true;
        this._cdr.detectChanges();

        setTimeout(() => {
            this.mobileSearchInputRef?.nativeElement.focus();
            if (this.searchTerm.trim().length >= 2) {
                this.showSearchResults = true;
            }
        }, 0);
    }

    /** Closes mobile search overlay. */
    closeMobileSearchOverlay(): void {
        this.showMobileSearchOverlay = false;
        this.showSearchResults = false;
        this.activeResultIndex = -1;
    }

    /** Returns all results. */
    get allResults(): Array<{ kind: 'channel' | 'user' | 'message'; item: any }> {
        return [
            ...this.channelResults.map((item) => ({ kind: 'channel' as const, item })),
            ...this.userResults.map((item) => ({ kind: 'user' as const, item })),
            ...this.messageResults.map((item) => ({ kind: 'message' as const, item })),
        ];
    }

    /** Handles on search input. */
    onSearchInput(value: string): void {
        this.searchTerm = value;
        if (!value.trim()) this.clearSearchResults();
        this.searchInput$.next(value);
    }

    /** Handles on search focus. */
    onSearchFocus(): void {
        if (this.searchTerm.trim().length >= 2) {
            this.showSearchResults = true;
        }
    }

    /** Handles on search enter. */
    onSearchEnter(event: Event): void {
        event.preventDefault();
        const target = this.allResults[this.activeResultIndex] ?? this.allResults[0];
        if (target) this.navigateByResult(target);
    }

    /** Handles on search blur. */
    onSearchBlur(): void {
        setTimeout(() => {
            this.showSearchResults = false;
            this.activeResultIndex = -1;
        }, 150);
    }

    /** Handles on search keydown. */
    onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.closeSearchResults();
            if (this.showMobileSearchOverlay) {
                this.closeMobileSearchOverlay();
            }
            return;
        }

        if (event.key === 'Enter') return this.handleSearchEnter(event);
        if (!this.showSearchResults) return;
        this.handleSearchArrowNavigation(event);
    }

    /** Handles handle search enter. */
    private handleSearchEnter(event: KeyboardEvent): void {
        this.allResults.length > 0 ? this.onSearchEnter(event) : this.triggerImmediateSearch();
    }

    /** Handles handle search arrow navigation. */
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

    /** Handles close search results. */
    closeSearchResults(): void {
        this.showSearchResults = false;
        this.activeResultIndex = -1;
    }

    /** Handles navigate to channel. */
    navigateToChannel(channelId: string): void {
        this.clearSearchResults();
        this.closeMobileSearchOverlay();
        void this.router.navigate(['/app/channel', channelId]);
    }

    /** Handles navigate to user. */
    navigateToUser(user: SearchUserResult): void {
        this.clearSearchResults();
        this.closeMobileSearchOverlay();
        void this.router.navigate(['/app/dm', user.id], {
            queryParams: { name: user.name },
        });
    }

    /** Handles navigate to message. */
    navigateToMessage(result: SearchMessageResult): void {
        this.clearSearchResults();
        this.closeMobileSearchOverlay();

        if (result.kind === 'dm' && result.partnerUserId) {
            void this.router.navigate(['/app/dm', result.partnerUserId], {
                queryParams: { msg: result.id },
            });
            return;
        }

        if (result.channelId) {
            void this.router.navigate(['/app/channel', result.channelId], {
                queryParams: { msg: result.id },
            });
        }
    }

    /** Handles init search pipeline. */
    private initSearchPipeline(): void {
        this._subscription.add(
            this.searchInput$
                .pipe(debounceTime(300), distinctUntilChanged())
                .subscribe((value) => {
                    const query = normalizeSearchToken(value.trim());

                    if (query.length < 2) {
                        this.clearSearchResults();
                        return;
                    }

                    this.activeResultIndex = -1;
                    this.isSearching = true;
                    this.showSearchResults = true;
                    this.runIndexedSearch(query);
                }),
        );
    }

    /** Handles trigger immediate search. */
    private triggerImmediateSearch(): void {
        const query = normalizeSearchToken(this.searchTerm.trim());
        if (query.length < 2) return;

        this.activeResultIndex = -1;
        this.isSearching = true;
        this.showSearchResults = true;
        this.runIndexedSearch(query);
    }

    /** Handles navigate by result. */
    private navigateByResult(result: { kind: string; item: any }): void {
        if (result.kind === 'channel') return this.navigateToChannel(result.item.id);
        if (result.kind === 'user') return this.navigateToUser(result.item);
        this.navigateToMessage(result.item);
    }

    /** Handles run indexed search. */
    private runIndexedSearch(rawQuery: string): void {
        const token = normalizeSearchToken(rawQuery);
        if (!token) return this.clearSearchResults();

        this.searchSubscription?.unsubscribe();
        this.searchSubscription = createSearchStream(token, this.buildSearchDependencies()).subscribe(
            ([channels, users, messages]) =>
                this.applySearchResults(channels, users, messages),
        );
    }

    /** Handles build search dependencies. */
    private buildSearchDependencies() {
        return {
            authService: this._authService,
            channelService: this._channelService,
            messageService: this.messageService,
            userService: this._userService,
            cachedChannels: this.cachedChannels,
            cachedUsers: this.cachedUsers,
        };
    }

    /** Handles clear search results. */
    private clearSearchResults(): void {
        this.showSearchResults = false;
        this.isSearching = false;
        this.activeResultIndex = -1;
        this.searchTerm = '';
        this.channelResults = [];
        this.userResults = [];
        this.messageResults = [];
    }

    /** Handles apply search results. */
    private applySearchResults(channels: any[], users: any[], messages: any[]): void {
        const mapped = mapSearchResults(channels, users, messages);
        this.channelResults = mapped.channels;
        this.userResults = mapped.users;
        this.messageResults = mapped.messages;
        this.isSearching = false;
        this.showSearchResults = this.searchTerm.trim().length > 0;
    }

    /** Returns true for extra small viewport. */
    private isSmallViewport(): boolean {
        return window.innerWidth <= 430;
    }

    /** Syncs viewport flags used by responsive interactions. */
    private syncViewportFlags(): void {
        this.isMobileUserMenuViewport = window.innerWidth < 768;
    }
}
