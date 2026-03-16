import { Channel } from '../../services/channel.service';
import { User } from '../../services/user.service';

export interface SidebarChannel {
    id: string;
    label: string;
    description?: string;
    hasUnread?: boolean;
    hasMention?: boolean;
}

export interface SidebarDirectMessage {
    id: string;
    label: string;
    isOnline: boolean;
    isSelf: boolean;
    avatar: string | null;
    hasAvatar: boolean;
    isActive: boolean;
    hasUnread?: boolean;
    hasMention?: boolean;
}

export interface SidebarRouteState {
    activeChannelId: string | null;
    activeDirectMessageId: string | null;
}

export function getUniqueMembers(
    members: User[],
    currentUserId: string,
): User[] {
    const map = new Map<string, User>();
    members.forEach((member) => mergeUniqueMember(map, member, currentUserId));
    return Array.from(map.values());
}

export function compareDirectMessages(
    left: SidebarDirectMessage,
    right: SidebarDirectMessage,
): number {
    if (left.isSelf) return -1;
    if (right.isSelf) return 1;
    return left.label.localeCompare(right.label, 'de');
}

export function normalizeDirectMessageLabel(label: string): string {
    return label.replace(' (Du)', '').trim();
}

export function resolveSidebarRouteState(url: string): SidebarRouteState {
    const channelMatch = /\/app\/channel\/([^/?#]+)/.exec(url);
    if (channelMatch?.[1]) {
        return {
            activeChannelId: decodeURIComponent(channelMatch[1]),
            activeDirectMessageId: null,
        };
    }

    const directMessageMatch = /\/app\/dm\/([^/?#]+)/.exec(url);
    if (directMessageMatch?.[1]) {
        return {
            activeChannelId: null,
            activeDirectMessageId: decodeURIComponent(directMessageMatch[1]),
        };
    }

    return { activeChannelId: null, activeDirectMessageId: null };
}

export function mapSidebarDirectMessages(
    members: User[],
    currentUserId: string,
    routeState: SidebarRouteState,
    unreadByDirectId: Record<string, boolean>,
    mentionByDirectId: Record<string, boolean>,
): SidebarDirectMessage[] {
    return getUniqueMembers(members, currentUserId)
        .sort((left, right) =>
            left.displayName.localeCompare(right.displayName, 'de'),
        )
        .filter((member) => !!member.id)
        .map((member) => {
            const id = member.id ?? '';
            const isSelf = id === currentUserId;
            const avatar = member.avatar ?? null;
            return {
                id,
                label: isSelf
                    ? `${member.displayName} (Du)`
                    : member.displayName,
                isOnline: member.presenceStatus === 'online',
                isSelf,
                avatar,
                hasAvatar: !!avatar,
                isActive: routeState.activeDirectMessageId === id,
                hasUnread: !isSelf && !!unreadByDirectId[id],
                hasMention: !isSelf && !!mentionByDirectId[id],
            } satisfies SidebarDirectMessage;
        })
        .sort(compareDirectMessages);
}

export function createUniqueChannelId(
    name: string,
    channels: SidebarChannel[],
): string {
    const base = slugify(name);
    if (!channels.some((channel) => channel.id === base)) {
        return base;
    }

    let index = 2;
    while (channels.some((channel) => channel.id === `${base}-${index}`)) {
        index += 1;
    }

    return `${base}-${index}`;
}

export function mapSidebarChannel(
    channel: Channel,
    canonicalChannelLabels: Record<string, string>,
    unreadByChannelId: Record<string, boolean>,
    mentionByChannelId: Record<string, boolean>,
): SidebarChannel {
    return {
        id: channel.id ?? '',
        label: canonicalChannelLabels[channel.id ?? ''] ?? channel.name,
        description: channel.description,
        hasUnread: !!unreadByChannelId[channel.id ?? ''],
        hasMention: !!mentionByChannelId[channel.id ?? ''],
    };
}

function mergeUniqueMember(
    map: Map<string, User>,
    member: User,
    currentUserId: string,
): void {
    const key = getMemberKey(member);
    if (!key) return;

    const existing = map.get(key);
    if (!existing || scoreMemberRecord(member, currentUserId) > scoreMemberRecord(existing, currentUserId)) {
        map.set(key, member);
    }
}

function scoreMemberRecord(member: User, currentUserId: string): number {
    let score = 0;
    if (member.id === currentUserId) score += 100;
    if (member.presenceStatus) score += 10;
    if (member.avatar) score += 2;
    return score;
}

function getMemberKey(member: User): string {
    const value = member.email || member.displayName || member.id || '';
    return value.toString().trim().toLowerCase();
}

function slugify(value: string): string {
    const normalized = value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);

    return normalized || 'channel';
}
