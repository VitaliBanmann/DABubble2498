import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
    distinctUntilChanged,
    firstValueFrom,
    map,
    Observable,
    of,
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

    /**
     * Rufe einen Kanal nach ID ab
     */
    getChannel(channelId: string): Observable<Channel | null> {
        return this.firestoreService.getDocument<Channel>(
            this.channelsCollection,
            channelId,
        );
    }

    /**
     * Rufe alle Kanäle ab
     */
    getAllChannels(): Observable<Channel[]> {
        return this.authService.currentUser$.pipe(
            map((user) => this.getMemberUid(user)),
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

    private getMemberUid(user: { uid: string; isAnonymous: boolean } | null): string {
        return user && !user.isAnonymous ? user.uid : '';
    }

    private getChannelsForUid(uid: string): Observable<Channel[]> {
        if (!uid) {
            return of([]);
        }

        return this.firestoreService.queryDocumentsRealtime<Channel>(
            this.channelsCollection,
            [where('members', 'array-contains', uid)],
        );
    }

    private updateChannelMembers(
        channelId: string,
        transform: (members: string[]) => string[],
    ): Observable<void> {
        return this.getChannel(channelId).pipe(
            take(1),
            switchMap((channel) => this.applyMemberUpdate(channelId, channel, transform)),
        );
    }

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

    private sameMembers(current: string[], updated: string[]): boolean {
        if (current.length !== updated.length) {
            return false;
        }

        return current.every((member, index) => member === updated[index]);
    }

    async ensureDefaultChannels(): Promise<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) return;
        await this.ensureChannelExists('allgemein', 'Allgemein', currentUser.uid);
        await this.ensureChannelExists('entwicklerteam', 'Entwicklerteam', currentUser.uid);
    }

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

    private normalizeChannelCreatePayload(channel: Channel): Channel {
        const members = new Set(channel.members ?? []);
        members.add(channel.createdBy);

        const admins = new Set(channel.admins ?? []);
        admins.add(channel.createdBy);
        admins.forEach((adminId) => members.add(adminId));

        return this.withSearchTokens({
            ...channel,
            members: Array.from(members),
            admins: Array.from(admins),
        });
    }

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
