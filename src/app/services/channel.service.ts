import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
    catchError,
    combineLatest,
    distinctUntilChanged,
    filter,
    firstValueFrom,
    map,
    Observable,
    of,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import { Timestamp, where } from 'firebase/firestore';
import { buildSearchTokens, normalizeSearchToken } from './search-token.util';

export interface Channel extends Record<string, unknown> {
    id?: string;
    name: string;
    description?: string;
    members: string[];
    memberIds?: string[];
    admins?: string[];
    createdBy: string;
    createdAt?: Timestamp | Date;
    updatedAt?: Date;
    avatar?: string;
    searchTokens?: string[];
}

@Injectable({
    providedIn: 'root',
})
export class ChannelService {
    private channelsCollection = 'channels';

    constructor(
        private firestoreService: FirestoreService,
        private authService: AuthService,
    ) {}

    /**
     * Erstelle einen neuen Kanal
     */
    createChannel(channel: Channel): Observable<string> {
        const payload = this.normalizeChannelCreatePayload(channel);
        return this.firestoreService.addDocument(this.channelsCollection, {
            ...payload,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    /** Handles create channel with id. */
    createChannelWithId(channelId: string, channel: Channel): Observable<string> {
        const payload = this.normalizeChannelCreatePayload(channel);
        return this.firestoreService
            .setDocument(this.channelsCollection, channelId, {
                ...payload,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .pipe(map(() => channelId));
    }

    /** Handles channel name exists. */
    channelNameExists(channelName: string, excludeChannelId = ''): Observable<boolean> {
        const normalizedTarget = this.normalizeChannelName(channelName);
        if (!normalizedTarget) {
            return of(false);
        }

        return this.getAllChannels().pipe(
            take(1),
            map((channels) =>
                channels.some((channel) => {
                    const currentId = (channel.id ?? '').toString().trim();
                    if (excludeChannelId && currentId === excludeChannelId) {
                        return false;
                    }

                    return this.normalizeChannelName(channel.name) === normalizedTarget;
                }),
            ),
        );
    }

    /** Handles normalize channel name. */
    private normalizeChannelName(value: string): string {
        return (value ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Rufe einen Kanal nach ID ab
     */
    getChannel(channelId: string): Observable<Channel | null> {
        return this.firestoreService.getDocument<Channel>(
            this.channelsCollection,
            channelId,
        );
    }

    /** Handles get all channels once. */
    getAllChannelsOnce(): Observable<Channel[]> {
        return combineLatest([
            this.authService.authReady$,
            this.authService.currentUser$.pipe(
                startWith(this.authService.getCurrentUser()),
            ),
        ]).pipe(
            filter(([isAuthReady]) => isAuthReady),
            map(([, user]) => this.getMemberUid(user)),
            distinctUntilChanged(),
            switchMap((uid) => this.getChannelsForUidOnce(uid)),
        );
    }

    /** Handles get channels for uid once. */
    private getChannelsForUidOnce(uid: string): Observable<Channel[]> {
        if (!uid) {
            return of([]);
        }

        return this.firestoreService
            .queryDocuments<Channel>(
                this.channelsCollection,
                [where('members', 'array-contains', uid)],
            )
            .pipe(
                catchError((error) => {
                    console.error('[CHANNEL ONE-TIME QUERY ERROR]', error);
                    return of([] as Channel[]);
                }),
                map((channels) =>
                    channels.filter((channel) =>
                        !!(channel.id ?? '').toString().trim(),
                    ),
                ),
            );
    }

    /** Handles get channel realtime. */
    getChannelRealtime(channelId: string): Observable<Channel | null> {
        return this.firestoreService.getDocumentRealtime<Channel>(
            this.channelsCollection,
            channelId,
        );
    }

    /**
     * Rufe alle Kanäle ab
     */
    getAllChannels(): Observable<Channel[]> {
        return combineLatest([
            this.authService.authReady$,
            this.authService.currentUser$.pipe(
                startWith(this.authService.getCurrentUser()),
            ),
        ]).pipe(
            filter(([isAuthReady]) => isAuthReady),
            map(([, user]) => this.getMemberUid(user)),
            distinctUntilChanged(),
            switchMap((uid) => this.getChannelsForUid(uid)),
        );
    }

    /**
     * Aktualisiere einen Kanal
     */
    updateChannel(
        channelId: string,
        updates: Partial<Channel>,
    ): Observable<void> {
        const payload = this.withSearchTokens(updates);
        return this.firestoreService.updateDocument(
            this.channelsCollection,
            channelId,
            { ...payload, updatedAt: new Date() },
        );
    }

    /** Handles search channels by token. */
    searchChannelsByToken(token: string): Observable<Channel[]> {
        const normalized = normalizeSearchToken(token);
        if (!normalized) {
            return of([]);
        }

        return this.firestoreService.queryDocuments<Channel>(
            this.channelsCollection,
            [where('searchTokens', 'array-contains', normalized)],
        );
    }

    /**
     * Lösche einen Kanal
     */
    deleteChannel(channelId: string): Observable<void> {
        return this.firestoreService.deleteDocument(
            this.channelsCollection,
            channelId,
        );
    }

    /**
     * Füge einen Mitglied zu einem Kanal hinzu
     */
    addMemberToChannel(channelId: string, userId: string): Observable<void> {
        return this.updateChannelMembers(channelId, (members) =>
            members.includes(userId) ? members : [...members, userId],
        );
    }

    /**
     * Entferne einen Mitglied aus einem Kanal
     */
    removeMemberFromChannel(
        channelId: string,
        userId: string,
    ): Observable<void> {
        return this.updateChannelMembers(channelId, (members) =>
            members.filter((id) => id !== userId),
        );
    }

    /** Handles get member uid. */
    private getMemberUid(user: { uid: string; isAnonymous: boolean } | null): string {
        return user && !user.isAnonymous ? user.uid : '';
    }

    private getChannelsForUid(uid: string): Observable<Channel[]> {
        if (!uid) {
            return of([]);
        }

        return this.firestoreService
            .queryDocumentsRealtime<Channel>(
                this.channelsCollection,
                [where('members', 'array-contains', uid)],
            )
            .pipe(
                catchError((error) => {
                    console.error('[CHANNEL REALTIME QUERY ERROR]', error);
                    return of([] as Channel[]);
                }),
                map((channels) =>
                    channels.filter((channel) =>
                        !!(channel.id ?? '').toString().trim(),
                    ),
                ),
            );
    }

    /** Handles update channel members. */
    private updateChannelMembers(
        channelId: string,
        transform: (members: string[]) => string[],
    ): Observable<void> {
        return this.getChannel(channelId).pipe(
            take(1),
            switchMap((channel) => this.applyMemberUpdate(channelId, channel, transform)),
        );
    }

    /** Handles apply member update. */
    private applyMemberUpdate(
        channelId: string,
        channel: Channel | null,
        transform: (members: string[]) => string[],
    ): Observable<void> {
        const currentMembers = this.resolveChannelMemberIds(channel);
        const updatedMembers = transform(currentMembers);
        if (this.sameMembers(currentMembers, updatedMembers)) {
            return of(void 0);
        }

        const rawChannel = channel as Record<string, unknown> | null;
        const payload: Partial<Channel> & { memberIds?: string[] } = {};
        const hasMemberIdsField = Array.isArray(rawChannel?.['memberIds']);
        const hasMembersField = Array.isArray(rawChannel?.['members']);

        if (hasMembersField || !hasMemberIdsField) {
            payload.members = updatedMembers;
        }

        if (hasMemberIdsField) {
            payload.memberIds = updatedMembers;
        }

        return this.updateChannel(channelId, payload as Partial<Channel>);
    }

    /** Handles resolve channel member ids. */
    private resolveChannelMemberIds(channel: Channel | null): string[] {
        const rawChannel = channel as Record<string, unknown> | null;
        const memberIds = rawChannel?.['memberIds'];
        if (Array.isArray(memberIds)) {
            return memberIds.filter((id): id is string => typeof id === 'string' && !!id);
        }

        const members = channel?.members ?? [];
        if (!Array.isArray(members)) return [];
        return members
            .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (typeof entry === 'object' && entry && 'id' in entry && typeof (entry as any).id === 'string') {
                    return (entry as any).id as string;
                }
                return null;
            })
            .filter((id): id is string => !!id);
    }

    /** Handles same members. */
    private sameMembers(current: string[], updated: string[]): boolean {
        if (current.length !== updated.length) {
            return false;
        }

        return current.every((member, index) => member === updated[index]);
    }

    /** Handles ensure default channels. */
    async ensureDefaultChannels(): Promise<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) return;
        await this.ensureChannelExists('allgemein', 'Allgemein', currentUser.uid);
        await this.ensureChannelExists('entwicklerteam', 'Entwicklerteam', currentUser.uid);
    }

    /** Handles ensure channel exists. */
    private async ensureChannelExists(id: string, name: string, uid: string): Promise<void> {
        const exists = await firstValueFrom(this.getChannel(id).pipe(take(1)));
        if (exists) return;
        const channel: Channel = {
            name,
            description: '',
            members: [uid],
            admins: [uid],
            createdBy: uid,
        };
        await firstValueFrom(this.createChannelWithId(id, channel));
    }

    /** Handles normalize channel create payload. */
    private normalizeChannelCreatePayload(channel: Channel): Channel {
        const members = new Set(channel.members ?? []);
        members.add(channel.createdBy);

        const admins = new Set(channel.admins ?? []);
        admins.add(channel.createdBy);
        admins.forEach((adminId) => members.add(adminId));

        return this.withSearchTokens({
            ...channel,
            members: Array.from(members),
            memberIds: Array.from(members),
            admins: Array.from(admins),
        });
    }

    /** Handles with search tokens. */
    private withSearchTokens<T extends Partial<Channel>>(payload: T): T & { searchTokens?: string[] } {
        const name = (payload.name ?? '').toString();
        const description = (payload.description ?? '').toString();
        const hasSearchableText = !!name.trim() || !!description.trim();
        if (!hasSearchableText) {
            return payload;
        }

        return {
            ...payload,
            searchTokens: buildSearchTokens([name, description]),
        };
    }
}
