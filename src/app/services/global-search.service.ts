import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, Subscription, take } from 'rxjs';
import { AuthService } from './auth.service';
import { Channel, ChannelService } from './channel.service';
import { MessageService } from './message.service';
import { User, UserService } from './user.service';
import { normalizeSearchToken } from './search-token.util';
import {
    SearchChannelResult,
    SearchMessageResult,
    SearchUserResult,
    createSearchStream,
    mapSearchResults,
} from '../layout/topbar/topbar-search.util';

export interface GlobalSearchResultState {
    channels: SearchChannelResult[];
    users: SearchUserResult[];
    messages: SearchMessageResult[];
}

@Injectable({
    providedIn: 'root',
})
export class GlobalSearchService {
    private cachedChannels: SearchChannelResult[] = [];
    private cachedUsers: User[] = [];

    constructor(
        private readonly authService: AuthService,
        private readonly channelService: ChannelService,
        private readonly messageService: MessageService,
        private readonly userService: UserService,
    ) {}

    /**
     * Preloads channel and user data used as fallback for fast local search.
     * @param subscription Subscription container that owns the warmup streams.
     */
    warmCache(subscription: Subscription): void {
        subscription.add(
            this.channelService
                .getAllChannels()
                .pipe(catchError(() => of([] as Channel[])))
                .subscribe((channels) => {
                    this.cachedChannels = mapSearchResults(channels, [], []).channels;
                }),
        );

        subscription.add(
            this.userService
                .getAllUsersRealtime()
                .pipe(catchError(() => of([] as User[])))
                .subscribe((users) => {
                    this.cachedUsers = users;
                }),
        );
    }

    /**
     * Searches channels, users and messages for the provided query string.
     * @param rawQuery Raw search input from the UI.
     * @returns Stream with grouped global search results.
     */
    search(rawQuery: string): Observable<GlobalSearchResultState> {
        const token = normalizeSearchToken(rawQuery);
        if (!token) {
            return of({
                channels: [],
                users: [],
                messages: [],
            });
        }

        return createSearchStream(token, {
            authService: this.authService,
            channelService: this.channelService,
            messageService: this.messageService,
            userService: this.userService,
            cachedChannels: this.cachedChannels,
            cachedUsers: this.cachedUsers,
        }).pipe(
            map(([channels, users, messages]) =>
                mapSearchResults(channels, users, messages),
            ),
        );
    }
}
