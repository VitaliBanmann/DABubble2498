import { Injectable } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { User as FirebaseUser } from 'firebase/auth';
import {
    catchError,
    combineLatest,
    map,
    Observable,
    of,
    Subscription,
    switchMap,
    take,
} from 'rxjs';
import { Channel, ChannelService } from '../services/channel.service';
import { Message, MessageService } from '../services/message.service';
import { UnreadStateService } from '../services/unread-state.service';
import { User, UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { HomeAuthBase } from './home-auth.base';

@Injectable()
export abstract class HomeRouteContextBase extends HomeAuthBase {
    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;
    currentChannel: Channel | null = null;
    errorMessage = '';
    connectionHint = '';
    usersById: Record<string, User> = {};

    protected currentChannelSubscription: Subscription | null = null;

    protected abstract get userService(): UserService;
    protected abstract get channelService(): ChannelService;
    protected abstract get route(): ActivatedRoute;
    protected abstract get messageService(): MessageService;
    protected abstract get unreadStateService(): UnreadStateService;

    protected abstract applyLiveMessages(messages: Message[]): void;
    protected abstract resetMessageStreams(): void;
    protected abstract resetThreadPanel(): void;
    protected abstract prepareMessageStreamSwitch(): void;

    protected subscribeToUsers(): void {
        this.subscription.add(
            this.userService.getAllUsers().subscribe({
                next: (users: User[]) => this.buildUserMap(users),
            }),
        );
    }

    protected subscribeToRouteMessages(): void {
        this.subscription.add(
            combineLatest({
                user: this.authService.currentUser$ as Observable<FirebaseUser | null>,
                params: this.route.paramMap as Observable<ParamMap>,
            }).subscribe({
                next: ({ user, params }) =>
                    this.handleRouteMessageContext(user, params),
                error: (error: unknown) => this.handleRouteMessageError(error),
            }),
        );
    }

    protected subscribeToQueryParams(): void {
        this.subscription.add(
            this.route.queryParamMap.subscribe((params: ParamMap) => {
                const msgId = params.get('msg');
                if (msgId) {
                    this.onPendingScrollMessage(msgId);
                }
            }),
        );
    }

    protected onPendingScrollMessage(_msgId: string): void {}

    protected buildUserMap(users: User[]): void {
        this.usersById = users.reduce<Record<string, User>>((acc, user) => {
            if (user.id) acc[user.id] = user;
            return acc;
        }, {});
        this.resolveCurrentDirectUserName();
    }

    protected resolveCurrentDirectUserName(preferredName = ''): void {
        if (!this.currentDirectUserId) { this.currentDirectUserName = ''; return; }
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
        const knownUser = this.usersById[this.currentDirectUserId];
        if (knownUser?.displayName) {
            this.currentDirectUserName = knownUser.displayName;
            return;
        }
        this.fetchDirectUserName(preferredName);
    }

    protected fetchDirectUserName(preferredName: string): void {
        this.userService.getUser(this.currentDirectUserId).pipe(take(1)).subscribe({
            next: (user) => this.applyFetchedDirectUserName(user, preferredName),
            error: () => this.applyDirectUserFallbackName(preferredName),
        });
    }

    protected applyFetchedDirectUserName(user: User | null, preferredName: string): void {
        this.currentDirectUserName =
            user?.displayName ?? preferredName ?? this.currentDirectUserId;
    }

    protected applyDirectUserFallbackName(preferredName: string): void {
        this.currentDirectUserName = preferredName || this.currentDirectUserId;
    }

    protected handleRouteMessageContext(user: FirebaseUser | null, params: ParamMap): void {
        if (!user) { this.clearMessagesState(); return; }
        this.loadMessagesForRoute(params);
    }

    protected loadMessagesForRoute(params: ParamMap): void {
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        this.errorMessage = '';
        if (directUserId) { this.setupDirectMessages(directUserId, directUserName); return; }
        this.setupChannelMessages(params);
    }

    protected setupDirectMessages(userId: string, name: string): void {
        this.applyDirectSnapshot(userId, name);
        this.currentChannelSubscription?.unsubscribe();
        this.currentChannelSubscription = null;
        this.currentChannel = null;
        this.prepareMessageStreamSwitch();
        this.startDirectLiveStream(userId);
        this.markCurrentContextAsRead();
    }

    protected startDirectLiveStream(_userId: string): void {}

    protected setupChannelMessages(params: ParamMap): void {
        const requestedChannelId = params.get('channelId') ?? 'allgemein';
        this.resolveAccessibleChannelId(requestedChannelId)
            .pipe(take(1))
            .subscribe({
                next: (channelId) =>
                    this.startResolvedChannelContext(channelId, requestedChannelId),
                error: (error) => this.handleRouteMessageError(error),
            });
    }

    protected resolveAccessibleChannelId(channelId: string): Observable<string> {
        if (this.isPublicChannelRoute(channelId)) return of(channelId);
        return this.channelService.getChannel(channelId).pipe(
            take(1),
            map((channel) => (channel?.id ? channelId : '')),
            catchError(() => of('')),
            switchMap((resolvedId) => this.resolveFallbackChannelId(resolvedId)),
        );
    }

    protected resolveFallbackChannelId(resolvedId: string): Observable<string> {
        if (resolvedId) return of(resolvedId);
        return this.channelService.getAllChannels().pipe(
            take(1),
            map((channels) => channels.find((channel) => !!channel.id)?.id ?? 'allgemein'),
        );
    }

    protected startResolvedChannelContext(channelId: string, requestedChannelId: string): void {
        this.applyChannelSnapshot(channelId);
        this.syncChannelRoute(channelId, requestedChannelId);
        this.subscribeToCurrentChannel();
        this.prepareMessageStreamSwitch();
        this.startChannelLiveStream(this.currentChannelId);
        this.markCurrentContextAsRead();
    }

    protected syncChannelRoute(channelId: string, requestedChannelId: string): void {
        if (channelId === requestedChannelId) return;
        this.router.navigate(['/app/channel', channelId]);
    }

    protected isPublicChannelRoute(channelId: string): boolean {
        return ['allgemein', 'entwicklerteam'].includes(channelId);
    }

    protected startChannelLiveStream(_channelId: string): void {}

    protected subscribeToCurrentChannel(): void {
        this.currentChannelSubscription?.unsubscribe();
        this.currentChannelSubscription = null;
        this.currentChannel = null;
        if (this.isDirectMessage || !this.currentChannelId) return;
        this.currentChannelSubscription = this.channelService
            .getChannel(this.currentChannelId)
            .subscribe({
                next: (channel: Channel | null) => { this.currentChannel = channel; },
                error: () => { this.currentChannel = null; },
            });
    }

    protected applyDirectSnapshot(userId: string, directUserName: string): void {
        this.isDirectMessage = true;
        this.currentDirectUserId = userId;
        this.currentDirectUserName = directUserName || userId;
    }

    protected applyChannelSnapshot(channelId: string): void {
        this.isDirectMessage = false;
        this.currentDirectUserId = '';
        this.currentDirectUserName = '';
        this.currentChannelId = channelId;
    }

    protected initializeConversationFromSnapshot(): void {
        const params = this.route.snapshot.paramMap;
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        if (directUserId) { this.applyDirectSnapshot(directUserId, directUserName); return; }
        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
    }

    protected clearMessagesState(): void {
        this.resetMessageStreams();
        this.messages = [];
    }

    abstract get messages(): Message[];
    abstract set messages(v: Message[]);

    protected handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.connectionHint = '';
        this.errorMessage = this.resolveLoadErrorMessage(error);
    }

    protected resolveLoadErrorMessage(error: unknown): string {
        const code = this.extractFirebaseErrorCode(error);
        if (code === 'permission-denied') return 'Nachrichten konnten nicht geladen werden (Rechteproblem).';
        if (code === 'failed-precondition') return 'Nachrichten konnten nicht geladen werden (Index fehlt/noch im Aufbau).';
        return 'Nachrichten konnten nicht geladen werden.';
    }

    protected extractFirebaseErrorCode(error: unknown): string {
        if (!error || typeof error !== 'object') return '';
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : '';
    }

    protected markCurrentContextAsRead(): void {
        if (!this.currentUserId || !this.canWrite) return;
        this.createReadMarkRequest().pipe(take(1)).subscribe({
            error: (e) => console.error('[READ MARK ERROR]', e),
        });
    }

    protected createReadMarkRequest(): Observable<void> {
        return this.isDirectMessage
            ? this.unreadStateService.markDirectAsRead(
                this.currentUserId!,
                this.currentDirectUserId,
            )
            : this.unreadStateService.markChannelAsRead(
                this.currentUserId!,
                this.currentChannelId,
            );
    }

    protected handleChannelLeaveSuccess(
        removedChannelId: string,
        channels: Channel[],
    ): void {
        (this as any).closeChannelPopup?.();
        (this as any).closeAddMemberPopup?.();
        (this as any).closeChannelMembersPopup?.();
        const nextChannel = channels.find(
            (c) => !!c.id && c.id !== removedChannelId,
        );
        if (nextChannel?.id) { this.router.navigate(['/app/channel', nextChannel.id]); return; }
        this.router.navigate(['/app']);
    }

    protected handleChannelLeaveError(error: unknown): void {
        console.error('[CHANNEL LEAVE ERROR]', error);
        this.errorMessage = 'Channel konnte nicht verlassen werden. Bitte erneut versuchen.';
    }

    onLeaveChannelRequested(): void {
        if (this.isDirectMessage || !this.currentChannelId || !this.currentUserId) return;
        const removedChannelId = this.currentChannelId;
        this.errorMessage = '';
        this.createLeaveChannelRequest(removedChannelId, this.currentUserId)
            .subscribe(this.leaveChannelObserver(removedChannelId));
    }

    protected createLeaveChannelRequest(channelId: string, userId: string): Observable<Channel[]> {
        return this.channelService.removeMemberFromChannel(channelId, userId).pipe(
            take(1),
            switchMap(() => this.channelService.getAllChannels().pipe(take(1))),
        );
    }

    protected leaveChannelObserver(channelId: string) {
        return {
            next: (channels: Channel[]) => this.handleChannelLeaveSuccess(channelId, channels),
            error: (e: unknown) => this.handleChannelLeaveError(e),
        };
    }
}
