import { Injectable } from '@angular/core';
import { Message, ThreadMessage } from '../services/message.service';
import { User } from '../services/user.service';
import { ChannelMembersPopupEntry } from '../layout/shell/channel-members-popup/channel-members-popup.component';
import { AddMemberPopupUser } from '../layout/shell/add-member-to-channel/add-member-to-channel.component';
import { HomeChannelManagementBase } from './home-channel-management.base';

@Injectable()
export abstract class HomeDisplayBase extends HomeChannelManagementBase {
    get currentChannelDescription(): string {
        const live = (this.currentChannel?.description ?? '').trim();
        if (live) return live;
        return this.channelDescriptions[this.currentChannelId] ??
            'Dieser Channel ist fuer alles rund um das Entwickeln vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.';
    }

    get currentChannelName(): string {
        const live = (this.currentChannel?.name ?? '').trim();
        if (live) return live;
        return this.channelNames[this.currentChannelId] ?? this.currentChannelId;
    }

    get currentChannelCreatorName(): string {
        const creatorIdOrName = (this.currentChannel?.createdBy ?? '').toString().trim();
        if (!creatorIdOrName) return 'Unbekannt';
        const user = this.usersById[creatorIdOrName];
        return (user?.displayName ?? '').trim() || creatorIdOrName;
    }

    get canDeleteCurrentChannel(): boolean {
        if (this.isDirectMessage || !this.currentChannelId || !this.currentUserId) {
            return false;
        }

        if (this.isProtectedDefaultChannel(this.currentChannelId)) {
            return false;
        }

        const createdBy = (this.currentChannel?.createdBy ?? '').toString().trim();
        return !!createdBy && createdBy === this.currentUserId;
    }

    get currentConversationTitle(): string {
        if (this.isDirectMessage) {
            const user = this.usersById[this.currentDirectUserId];
            return user?.displayName || this.currentDirectUserName || this.currentDirectUserId;
        }

        return this.currentChannelName;
    }

    get latestMessageSummary(): string {
        const latest = this.messages[this.messages.length - 1];
        if (!latest) return '';

        const stamp = this.formatDateAndTime(latest.timestamp);
        const sender = this.getSenderLabel(latest);
        const text = (latest.text ?? '').trim();
        return `${sender}: ${text || '(nur Anhang)'} (${stamp})`;
    }

    get activeThreadTitle(): string {
        return this.activeThreadParent?.text ?? 'Thread';
    }

    get visibleChannelMembers(): User[] {
        return this.getChannelMembers().slice(0, this.maxVisibleChannelMembers);
    }

    get channelMembersPopupEntries(): ChannelMembersPopupEntry[] {
        return this.getChannelMembers().map((user) => ({
            id: user.id ?? '',
            displayName: user.displayName,
            avatar: this.getUserAvatar(user),
            isSelf: !!user.id && user.id === this.currentUserId,
            isOnline: user.presenceStatus === 'online',
        }));
    }

    get addMemberPopupAvailableUsers(): AddMemberPopupUser[] {
        const memberIds = new Set(this.extractChannelMemberIds());

        return (Object.values(this.usersById) as User[])
            .filter(
                (user) =>
                    !!user.id &&
                    user.id !== this.currentUserId &&
                    !memberIds.has(user.id),
            )
            .map((user) => ({
                id: user.id as string,
                displayName: user.displayName,
                avatar: this.getUserAvatar(user),
                isOnline: user.presenceStatus === 'online',
            }));
    }

    get remainingChannelMembersCount(): number {
        return Math.max(this.getChannelMembers().length - this.maxVisibleChannelMembers, 0);
    }

    get channelMembersCount(): number {
        return this.getChannelMembers().length;
    }

    getUserAvatar(user: User): string {
        const fallback = 'assets/pictures/profile.svg';
        const raw = (user?.avatar ?? '').trim();
        return raw ? this.normalizeAvatarPath(raw, fallback) : fallback;
    }

    getMentionAvatar(userId: string): string {
        const user = this.usersById[userId];
        return user ? this.getUserAvatar(user) : 'assets/pictures/profile.svg';
    }

    isMentionUserOnline(userId: string): boolean {
        return this.usersById[userId]?.presenceStatus === 'online';
    }

    getMessageAvatar(message: Message): string {
        const fallback = 'assets/pictures/profile.svg';
        const user = this.usersById[message.senderId];
        const raw = (user?.avatar ?? '').trim();
        return raw ? this.normalizeAvatarPath(raw, fallback) : fallback;
    }

    getSenderLabel(message: Message): string {
        if (this.isOwnMessage(message)) return 'Du';
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getThreadSenderLabel(message: ThreadMessage): string {
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getVisibleChannelMembers(): User[] {
        return this.getChannelMembers().slice(0, this.maxVisibleChannelMembers);
    }

    getRemainingChannelMembersCount(): number {
        return Math.max(this.getChannelMembers().length - this.maxVisibleChannelMembers, 0);
    }

    override trackMessage(index: number, message: Message): string {
        if (message.id) return message.id;
        const ts = this.resolveTrackTimestamp(message.timestamp, index);
        return `${message.senderId}-${ts}-${message.text}`;
    }

    trackThreadMessage(index: number, message: ThreadMessage): string {
        if (message.id) return message.id;
        return this.trackMessage(index, message as Message);
    }

    protected getChannelMembers(): User[] {
        return this.extractChannelMemberIds()
            .map((id) => this.usersById[id])
            .filter((user): user is User => !!user);
    }

    protected extractChannelMemberIds(): string[] {
        const channel = this.currentChannel as Record<string, unknown> | null;
        if (!channel) return [];
        const directIds = this.extractDirectMemberIds(channel);
        if (directIds) return directIds;
        return this.extractNestedMemberIds(channel);
    }

    private extractDirectMemberIds(channel: Record<string, unknown>): string[] | null {
        const direct = channel['memberIds'];
        if (!Array.isArray(direct)) return null;
        return direct.filter((id): id is string => typeof id === 'string' && !!id);
    }

    private extractNestedMemberIds(channel: Record<string, unknown>): string[] {
        const members = channel['members'];
        if (!Array.isArray(members)) return [];
        return members.map((entry) => this.extractMemberId(entry)).filter((id): id is string => !!id);
    }

    protected extractMemberId(entry: unknown): string | null {
        if (typeof entry === 'string') return entry;

        if (typeof entry === 'object' && entry && 'id' in entry && typeof (entry as any).id === 'string') {
            return (entry as any).id;
        }

        return null;
    }

    protected normalizeAvatarPath(avatar: string, fallback: string): string {
        const trimmed = avatar.trim();
        if (!trimmed) return fallback;
        if (this.isExternalAvatar(trimmed) || this.isAssetAvatar(trimmed)) return trimmed;
        return `assets/pictures/${trimmed}`;
    }

    protected isExternalAvatar(value: string): boolean {
        return ['http://', 'https://', 'data:', 'blob:'].some((prefix) => value.startsWith(prefix));
    }

    protected isAssetAvatar(value: string): boolean {
        return value.startsWith('/assets/') || value.startsWith('assets/');
    }
}
