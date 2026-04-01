import { Injectable } from '@angular/core';
import { ElementRef } from '@angular/core';
import { take } from 'rxjs';
import { Channel, ChannelService } from '../services/channel.service';
import { Message, MessageService, ThreadMessage } from '../services/message.service';
import { User } from '../services/user.service';
import { ChannelMembersPopupEntry } from '../layout/shell/channel-members-popup/channel-members-popup.component';
import { AddMemberPopupUser } from '../layout/shell/add-member-to-channel/add-member-to-channel.component';
import { HomeMessageActionsBase } from './home-message-actions.base';

@Injectable()
export abstract class HomeDisplayBase extends HomeMessageActionsBase {
    isChannelPopupOpen = false;
    isAddMemberPopupOpen = false;
    isChannelMembersPopupOpen = false;
    channelPopupLeft = 24;
    channelPopupTop = 100;
    channelMembersPopupLeft = 24;
    channelMembersPopupTop = 120;
    hasSentWelcomeMessage = false;

    readonly maxVisibleChannelMembers = 3;

    protected abstract channelTitleTriggerRef?: ElementRef<HTMLElement>;
    protected abstract membersAvatarTriggerRef?: ElementRef<HTMLElement>;

    get currentChannelDescription(): string {
        const live = (this.currentChannel?.description ?? '').trim();
        if (live) return live;
        return this.channelDescriptions[this.currentChannelId] ??
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.';
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

    get currentConversationTitle(): string {
        if (this.isDirectMessage) {
            const u = this.usersById[this.currentDirectUserId];
            return u?.displayName || this.currentDirectUserName || this.currentDirectUserId;
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

    get channelMembersCount(): number { return this.getChannelMembers().length; }

    openChannelPopup(): void {
        if ((this as any).isComposeMode || this.isDirectMessage) return;
        this.positionChannelPopup();
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isChannelPopupOpen = true;
    }

    closeChannelPopup(): void { this.isChannelPopupOpen = false; }

    onAddMemberClick(): void {
        this.isChannelPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isAddMemberPopupOpen = true;
    }

    closeAddMemberPopup(): void { this.isAddMemberPopupOpen = false; }

    onAddMemberSubmit(userId: string): void {
        if (!userId || this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        const previousChannel = this.currentChannel;
        if (this.currentChannel) {
            this.currentChannel = this.withLocallyAddedMember(this.currentChannel, userId);
        }

        // Close immediately on first click; realtime channel update will refresh member UI.
        this.isAddMemberPopupOpen = false;
        this.channelService
            .addMemberToChannel(this.currentChannelId, userId)
            .pipe(take(1))
            .subscribe({
                next: () => {},
                error: (error: unknown) => {
                    this.currentChannel = previousChannel;
                    console.error('[ADD CHANNEL MEMBER ERROR]', error);
                    this.errorMessage = 'Mitglied konnte nicht hinzugefügt werden.';
                },
            });
    }

    private withLocallyAddedMember(channel: Channel, userId: string): Channel {
        const rawChannel = channel as Record<string, unknown>;
        const baseMembers = this.extractChannelMemberIdsFromRaw(rawChannel);
        if (baseMembers.includes(userId)) return channel;

        const updatedMembers = [...baseMembers, userId];
        return {
            ...channel,
            members: updatedMembers,
            ...(Array.isArray(rawChannel['memberIds']) ? { memberIds: updatedMembers } : {}),
        };
    }

    private extractChannelMemberIdsFromRaw(channel: Record<string, unknown>): string[] {
        const memberIds = channel['memberIds'];
        if (Array.isArray(memberIds)) {
            return memberIds.filter((id): id is string => typeof id === 'string' && !!id);
        }

        const members = channel['members'];
        if (!Array.isArray(members)) return [];
        return members
            .map((entry) => this.extractMemberId(entry))
            .filter((id): id is string => !!id);
    }

    openChannelMembersPopup(): void {
        if ((this as any).isComposeMode || this.isDirectMessage) return;
        this.positionChannelMembersPopup();
        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = true;
    }

    closeChannelMembersPopup(): void { this.isChannelMembersPopupOpen = false; }

    protected positionChannelMembersPopup(): void {
        const el = this.membersAvatarTriggerRef?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const pw = Math.min(415, vw - 48);
        this.channelMembersPopupLeft = Math.min(Math.max(Math.round(rect.right - pw), 24), Math.max(24, vw - pw - 24));
        this.channelMembersPopupTop = Math.round(rect.bottom + 12);
    }

    protected positionChannelPopup(): void {
        const el = this.channelTitleTriggerRef?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const pw = Math.min(760, vw - 48);
        this.channelPopupLeft = Math.min(Math.max(Math.round(rect.left), 24), Math.max(24, vw - pw - 24));
        this.channelPopupTop = Math.round(rect.bottom + 12);
    }

    onChannelNameChanged(nextName: string): void {
        const name = nextName.trim();
        if (!name || this.isDirectMessage || !this.currentChannelId) return;
        this.channelNames[this.currentChannelId] = name;
        if (this.currentChannel) this.currentChannel = { ...this.currentChannel, name };
        this.channelService.updateChannel(this.currentChannelId, { name }).pipe(take(1)).subscribe({
            error: (e: unknown) => console.error('[CHANNEL NAME UPDATE ERROR]', e),
        });
    }

    onChannelDescriptionChanged(nextDescription: string): void {
        const description = nextDescription.trim();
        if (!description || this.isDirectMessage || !this.currentChannelId) return;
        this.channelDescriptions[this.currentChannelId] = description;
        if (this.currentChannel) this.currentChannel = { ...this.currentChannel, description };
        this.channelService.updateChannel(this.currentChannelId, { description }).pipe(take(1)).subscribe({
            error: (e: unknown) => console.error('[CHANNEL DESCRIPTION UPDATE ERROR]', e),
        });
    }

    getUserAvatar(user: User): string {
        const fallback = 'assets/pictures/profile.svg';
        const raw = (user?.avatar ?? '').trim();
        return raw ? this.normalizeAvatarPath(raw, fallback) : fallback;
    }

    getMessageAvatar(message: Message): string {
        const fallback = 'assets/pictures/profile.svg';
        const user = this.usersById[message.senderId];
        const raw = (user?.avatar ?? '').trim();
        return raw ? this.normalizeAvatarPath(raw, fallback) : fallback;
    }

    protected getChannelMembers(): User[] {
        return this.extractChannelMemberIds()
            .map((id) => this.usersById[id])
            .filter((u): u is User => !!u);
    }

    protected extractChannelMemberIds(): string[] {
        const channel = this.currentChannel as Record<string, unknown> | null;
        if (!channel) return [];
        const direct = channel['memberIds'];
        if (Array.isArray(direct)) return direct.filter((id): id is string => typeof id === 'string' && !!id);
        const members = channel['members'];
        if (Array.isArray(members)) {
            return members.map((entry) => this.extractMemberId(entry)).filter((id): id is string => !!id);
        }
        return [];
    }

    protected extractMemberId(entry: unknown): string | null {
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object' && entry && 'id' in entry && typeof (entry as any).id === 'string') {
            return (entry as any).id;
        }
        return null;
    }

    protected normalizeAvatarPath(avatar: string, fallback: string): string {
        const t = avatar.trim();
        if (!t) return fallback;
        if (this.isExternalAvatar(t) || this.isAssetAvatar(t)) return t;
        return `assets/pictures/${t}`;
    }

    protected isExternalAvatar(v: string): boolean {
        return ['http://', 'https://', 'data:', 'blob:'].some((p) => v.startsWith(p));
    }

    protected isAssetAvatar(v: string): boolean {
        return v.startsWith('/assets/') || v.startsWith('assets/');
    }

    getSenderLabel(message: Message): string {
        if (this.isOwnMessage(message)) return 'Du';
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getThreadSenderLabel(message: ThreadMessage): string {
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getVisibleChannelMembers(): User[] { return this.getChannelMembers().slice(0, this.maxVisibleChannelMembers); }

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
}
