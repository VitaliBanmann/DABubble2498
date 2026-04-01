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
    const channelId = extractRouteSegment(url, /\/app\/channel\/([^/?#]+)/);
    if (channelId) return { activeChannelId: channelId, activeDirectMessageId: null };
    const directId = extractRouteSegment(url, /\/app\/dm\/([^/?#]+)/);
    if (directId) return { activeChannelId: null, activeDirectMessageId: directId };
    return { activeChannelId: null, activeDirectMessageId: null };
}

function extractRouteSegment(url: string, pattern: RegExp): string | null {
    const match = pattern.exec(url);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function mapSidebarDirectMessages(
    members: User[],
    currentUserId: string,
    routeState: SidebarRouteState,
    unreadByDirectId: Record<string, boolean>,
    mentionByDirectId: Record<string, boolean>,
): SidebarDirectMessage[] {
    return getUniqueMembers(members, currentUserId)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))
        .filter((member) => !!member.id)
        .map((member) => toSidebarDirectMessage(member, currentUserId, routeState, unreadByDirectId, mentionByDirectId))
        .sort(compareDirectMessages);
}

function toSidebarDirectMessage(
    member: User,
    currentUserId: string,
    routeState: SidebarRouteState,
    unreadByDirectId: Record<string, boolean>,
    mentionByDirectId: Record<string, boolean>,
): SidebarDirectMessage {
    const id = member.id ?? '', isSelf = id === currentUserId;
    return {
        id,
        label: formatDirectLabel(member.displayName, isSelf),
        isOnline: member.presenceStatus === 'online',
        isSelf,
        avatar: member.avatar ?? null,
        hasAvatar: !!member.avatar,
        isActive: routeState.activeDirectMessageId === id,
        hasUnread: !isSelf && !!unreadByDirectId[id],
        hasMention: !isSelf && !!mentionByDirectId[id],
    };
}

function formatDirectLabel(displayName: string, isSelf: boolean): string {
    return isSelf ? `${displayName} (Du)` : displayName;
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
    const id = (channel.id ?? '').toString().trim();
    const canonicalLabel = canonicalChannelLabels[id];
    const rawName = (channel.name ?? '').toString().trim();
    const label = canonicalLabel || rawName || id || 'Unbenannter Channel';

    return {
        id,
        label,
        description: channel.description,
        hasUnread: !!unreadByChannelId[id],
        hasMention: !!mentionByChannelId[id],
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
    if (!existing || hasBetterMemberScore(member, existing, currentUserId)) {
        map.set(key, member);
    }
}

function hasBetterMemberScore(candidate: User, current: User, currentUserId: string): boolean {
    return scoreMemberRecord(candidate, currentUserId) > scoreMemberRecord(current, currentUserId);
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
