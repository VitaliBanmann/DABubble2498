import {
    combineLatest,
    Observable,
    catchError,
    distinctUntilChanged,
    map,
    of,
    startWith,
    switchMap,
} from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { normalizeSearchToken } from '../../services/search-token.util';
import { PresenceStatus, User, UserService } from '../../services/user.service';

export interface SearchChannelResult {
    id: string;
    name: string;
}

export interface SearchUserResult {
    id: string;
    name: string;
    email: string;
}

export interface SearchMessageResult {
    id: string;
    text: string;
    kind: 'channel' | 'dm';
    channelId?: string;
    conversationId?: string;
    partnerUserId?: string;
}

const defaultChannels: SearchChannelResult[] = [
    { id: 'allgemein', name: 'Allgemein' },
    { id: 'entwicklerteam', name: 'Entwicklerteam' },
];

/** Handles get initials. */
export function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return parts[0][0].toUpperCase();
}

/** Handles get presence label. */
export function getPresenceLabel(status: PresenceStatus): string {
    switch (status) {
        case 'online':
            return 'Online';
        case 'away':
            return 'Abwesend';
        default:
            return 'Offline';
    }
}

/** Handles resolve profile email. */
export function resolveProfileEmail(profile: Record<string, unknown>): string {
    const candidates = [
        profile['email'],
        profile['mail'],
        profile['emailAddress'],
        profile['eMail'],
    ];
    const firstEmail = candidates.find(
        (value) => typeof value === 'string' && value.trim().length > 0,
    );
    return typeof firstEmail === 'string' ? firstEmail.trim() : '';
}

/** Handles resolve avatar url. */
export function resolveAvatarUrl(avatar: string): string {
    const trimmed = avatar.trim();
    if (!trimmed) return '';
    if (
        trimmed.startsWith('data:image/') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('assets/')
    ) {
        return trimmed;
    }
    return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
}

/** Handles truncate text. */
export function truncateText(text: string, maxLength = 60): string {
    const trimmed = (text ?? '').trim();
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

/** Handles map search results. */
export function mapSearchResults(
    channels: any[],
    users: any[],
    messages: any[],
) {
    return {
        channels: mapChannelResults(channels),
        users: mapUserResults(users),
        messages: mapMessageResults(messages),
    };
}

/** Handles map channel results. */
function mapChannelResults(channels: any[]): SearchChannelResult[] {
    return channels.filter((channel) => !!channel?.id).map((channel) => ({ id: channel.id as string, name: channel.name })).slice(0, 5);
}

/** Handles map user results. */
function mapUserResults(users: any[]): SearchUserResult[] {
    return users.filter((user) => !!user?.id).map((user) => ({ id: user.id as string, name: user.displayName, email: user.email })).slice(0, 5);
}

/** Handles map message results. */
function mapMessageResults(messages: any[]): SearchMessageResult[] {
    return messages.filter((message) => !!message?.id && (message.channelId || message.conversationId)).map((message) => ({
        id: message.id as string,
        text: truncateText(message.text),
        kind: (message.kind ?? 'channel') as 'channel' | 'dm',
        channelId: message.channelId,
        conversationId: message.conversationId,
        partnerUserId: message.partnerUserId,
    })).slice(0, 5);
}

/** Handles merge with defaults. */
export function mergeWithDefaults(channels: any[]): SearchChannelResult[] {
    const merged = new Map<string, SearchChannelResult>(
        defaultChannels.map((channel) => [channel.id, channel]),
    );

    channels
        .filter((channel) => !!channel?.id)
        .forEach((channel) => {
            merged.set(channel.id, { id: channel.id, name: channel.name });
        });

    return Array.from(merged.values());
}

/** Handles create search stream. */
export function createSearchStream(
    token: string,
    deps: {
        authService: AuthService;
        channelService: ChannelService;
        messageService: MessageService;
        userService: UserService;
        cachedChannels: SearchChannelResult[];
        cachedUsers: User[];
    },
) {
    return combineLatest([
        buildChannelResults(token, deps),
        buildUserResults(token, deps),
        buildMessageResults(token, deps),
    ]);
}

/** Handles matches search. */
function matchesSearch(parts: Array<unknown>, token: string): boolean {
    return parts.some((part) =>
        normalizeSearchToken(String(part ?? '')).includes(token),
    );
}

/** Handles build channel results. */
function buildChannelResults(
    token: string,
    deps: {
        channelService: ChannelService;
        cachedChannels: SearchChannelResult[];
    },
) {
    const fallback = deps.cachedChannels.filter((channel) => matchesSearch([channel.name], token));
    return deps.channelService.getAllChannels().pipe(
        startWith(null),
        map((channels) => filterChannelResults(channels ? mergeWithDefaults(channels) : deps.cachedChannels, token)),
        catchError(() => of(fallback)),
    );
}

/** Handles filter channel results. */
function filterChannelResults(channels: SearchChannelResult[], token: string): SearchChannelResult[] {
    return channels.filter((channel) => matchesSearch([channel.name], token));
}

/** Handles build user results. */
function buildUserResults(
    token: string,
    deps: {
        cachedUsers: User[];
        userService: UserService;
    },
) {
    const fallback = deps.cachedUsers.filter((user) => matchesSearch([user?.displayName, user?.email], token));
    return deps.userService.getAllUsersRealtime().pipe(
        startWith(deps.cachedUsers),
        map((users) => users.filter((user) => matchesSearch([user?.displayName, user?.email], token))),
        catchError(() => of(fallback)),
    );
}

/** Handles build message results. */
function buildMessageResults(
    token: string,
    deps: {
        authService: AuthService;
        channelService: ChannelService;
        messageService: MessageService;
        userService: UserService;
    },
) {
    return combineLatest([
        buildChannelMessageResults(token, deps).pipe(startWith([] as any[])),
        buildDmMessageResults(token, deps).pipe(startWith([] as any[])),
    ] as [Observable<any[]>, Observable<any[]>]).pipe(
        map(([channelMessages, directMessages]) => mergeSearchMessages(channelMessages, directMessages)),
        catchError(() => of([])),
    );
}

/** Handles merge search messages. */
function mergeSearchMessages(channelMessages: any[], directMessages: any[]): any[] {
    return [...channelMessages, ...directMessages].sort((left, right) => new Date(right?.timestamp ?? 0).getTime() - new Date(left?.timestamp ?? 0).getTime()).slice(0, 20);
}

/** Handles build channel message results. */
function buildChannelMessageResults(
    token: string,
    deps: {
        channelService: ChannelService;
        messageService: MessageService;
    },
) {
    return getSearchableChannelIds(deps.channelService).pipe(
        distinctUntilChanged((left, right) => left.join(',') === right.join(',')),
        switchMap((channelIds) => loadChannelMessageResults(channelIds, token, deps.messageService)),
        catchError(() => of([])),
    );
}

/** Handles load channel message results. */
function loadChannelMessageResults(channelIds: string[], token: string, messageService: MessageService): Observable<any[]> {
    if (!channelIds.length) return of([]);
    return combineLatest(channelIds.map((channelId) => messageService.streamLatestChannelMessages(channelId, 200).pipe(
        map((messages) => messages.filter((message) => matchesSearch([message?.text], token)).map((message) => ({ ...message, kind: 'channel' as const, channelId }))),
        catchError(() => of([] as any[])),
    ))).pipe(map((grouped) => grouped.flat()));
}

/** Handles build dm message results. */
function buildDmMessageResults(
    token: string,
    deps: {
        authService: AuthService;
        messageService: MessageService;
        userService: UserService;
    },
) {
    return deps.userService.getAllUsersRealtime().pipe(
        map((users) => users.map((user) => user.id as string).filter(Boolean).sort()),
        distinctUntilChanged((left, right) => left.join(',') === right.join(',')),
        switchMap((userIds) => loadDmMessageResults(userIds, token, deps)),
        catchError(() => of([])),
    );
}

/** Handles load dm message results. */
function loadDmMessageResults(
    userIds: string[],
    token: string,
    deps: { authService: AuthService; messageService: MessageService },
): Observable<any[]> {
    const currentUser = deps.authService.getCurrentUser();
    const otherIds = currentUser ? userIds.filter((id) => id !== currentUser.uid) : [];
    if (!currentUser || !otherIds.length) return of([]);
    return combineLatest(otherIds.map((userId) => deps.messageService.streamLatestDirectMessages(userId, 200).pipe(
        map((messages) => messages.filter((message) => matchesSearch([message?.text], token)).map((message) => ({ ...message, kind: 'dm' as const, partnerUserId: userId }))),
        catchError(() => of([])),
    ))).pipe(map((grouped) => grouped.flat()));
}

/** Handles get searchable channel ids. */
function getSearchableChannelIds(channelService: ChannelService) {
    const publicIds = ['allgemein', 'entwicklerteam'];

    return channelService.getAllChannels().pipe(
        map((channels) => {
            const memberIds = channels
                .map((channel) => channel?.id as string)
                .filter(Boolean);
            return [...new Set([...publicIds, ...memberIds])].sort();
        }),
        catchError(() => of(publicIds)),
    );
}
