import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    Directive,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    QueryList,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
    combineLatest,
    of,
    Observable,
    retry,
    Subscription,
    switchMap,
    take,
    throwError,
    timer,
} from 'rxjs';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    MessageService,
    ThreadMessage,
} from '../services/message.service';
import { AttachmentService } from '../services/attachment.service';
import { UiStateService } from '../services/ui-state.service';
import { UnreadStateService } from '../services/unread-state.service';
import { User, UserService } from '../services/user.service';
import { User as FirebaseUser } from 'firebase/auth';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';

interface MentionCandidate {
    id: string;
    label: string;
}

interface ComposeTargetSuggestion {
    kind: 'channel' | 'user';
    id: string;
    label: string;
    value: string;
    subtitle: string;
}

interface MessageGroup {
    id: string;
    senderId: string;
    isOwn: boolean;
    startedAt: Message['timestamp'];
    messages: Message[];
}

@Directive()
export class HomeComponentBase1 {
    [key: string]: any;

    get isComposeMode(): boolean {
        return this.ui.isNewMessageOpen();
    }

ngOnInit(): void {
        this.ui.closeThread();
        this.initializeConversationFromSnapshot();
        this.subscribeToAuth();
        this.subscribeToUsers();
        this.subscribeToRouteMessages();
        this.subscribeToQueryParams();
        this.syncComposerState();
        setTimeout(() => this.resizeComposerTextarea(), 0);
    }

protected initializeConversationFromSnapshot(): void {
        const params = this.route.snapshot.paramMap;
        const directUserId = params.get('userId') ?? '';
        const directUserName =
            this.route.snapshot.queryParamMap.get('name')?.trim() ?? '';
        if (directUserId)
            return this.applyDirectSnapshot(directUserId, directUserName);
        this.applyChannelSnapshot(params.get('channelId') ?? 'allgemein');
    }

protected subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe((incomingUser: FirebaseUser | null) =>
                this.handleAuthUserChange(incomingUser),
            ),
        );
    }

protected subscribeToQueryParams(): void {
        this.subscription.add(
            this.route.queryParamMap.subscribe((params: ParamMap) => {
                const msgId = params.get('msg');
                if (msgId) {
                    this.pendingScrollToMessageId = msgId;
                    this.tryScrollToMessage();
                }
            }),
        );
    }

protected tryScrollToMessage(): void {
        const msgId = this.pendingScrollToMessageId;
        if (!msgId) return;
        setTimeout(() => this.highlightScrolledMessage(msgId), 400);
    }

    protected highlightScrolledMessage(msgId: string): void {
        const el = document.getElementById('msg-' + msgId);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message__line--highlight');
        this.pendingScrollToMessageId = null;
        setTimeout(() => el.classList.remove('message__line--highlight'), 2500);
    }

onComposeTargetInput(): void {
        this.composeTargetActiveIndex = -1;
        this.errorMessage = '';
        this.updateComposeTargetSuggestions();
    }

selectComposeTargetSuggestion(suggestion: ComposeTargetSuggestion): void {
        this.composeTargetControl.setValue(suggestion.value);
        this.hideComposeTargetSuggestions();
    }

protected updateComposeTargetSuggestions(): void {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) return this.hideComposeTargetSuggestions();

        const query = raw.slice(1).trim().toLowerCase();
        if (raw.startsWith('#')) return this.setChannelSuggestions(query);
        if (raw.startsWith('@')) return this.setUserSuggestions(query);

        this.hideComposeTargetSuggestions();
    }

protected setChannelSuggestions(query: string): void {
    const entries = (Object.entries(this.channelNames) as Array<[string, string]>)
            .filter(([id, label]) => this.matchesQuery(query, id, label))
            .slice(0, 6)
            .map(([id, label]) => this.toChannelSuggestion(id, label));

        this.applyComposeSuggestions(entries);
    }

onComposeTargetKeydown(event: KeyboardEvent): void {
        if (!this.showComposeTargetSuggestions) {
            if (event.key === 'Enter') this.onComposeTargetSubmit();
            return;
        }
        if (event.key === 'ArrowDown') return this.focusNextSuggestion(event);
        if (event.key === 'ArrowUp') return this.focusPreviousSuggestion(event);
        if (event.key === 'Enter') return this.confirmActiveSuggestion(event);
        if (event.key === 'Escape') this.hideComposeTargetSuggestions();
    }

onComposeTargetBlur(): void {
        setTimeout(() => this.hideComposeTargetSuggestions(), 100);
    }

onComposeTargetOptionMouseDown(
        suggestion: ComposeTargetSuggestion,
        event: MouseEvent,
    ): void {
        event.preventDefault();
        this.selectComposeTargetSuggestion(suggestion);
    }

protected focusNextSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(1);
    }

protected focusPreviousSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        this.moveComposeSelection(-1);
    }

protected confirmActiveSuggestion(event: KeyboardEvent): void {
        event.preventDefault();
        const item =
            this.composeTargetSuggestions[this.composeTargetActiveIndex];
        if (item) this.selectComposeTargetSuggestion(item);
        else this.onComposeTargetSubmit();
    }

protected moveComposeSelection(step: number): void {
        const len = this.composeTargetSuggestions.length;
        if (!len) return;
        const start =
            this.composeTargetActiveIndex < 0
                ? step > 0
                    ? -1
                    : 0
                : this.composeTargetActiveIndex;
        this.composeTargetActiveIndex = (start + step + len) % len;
    }

protected setUserSuggestions(query: string): void {
    const entries = (Object.values(this.usersById) as User[])
            .filter((user) => this.isValidSuggestionUser(user))
            .filter((user) =>
                this.matchesQuery(query, user.displayName, user.email ?? ''),
            )
            .slice(0, 6)
            .map((user) => this.toUserSuggestion(user));

        this.applyComposeSuggestions(entries);
    }

protected matchesQuery(
        query: string,
        primary: string,
        secondary: string,
    ): boolean {
        if (!query) return true;
        const left = primary.trim().toLowerCase();
        const right = secondary.trim().toLowerCase();
        return left.includes(query) || right.includes(query);
    }

protected isValidSuggestionUser(user: User): boolean {
        return !!user.id && user.id !== this.currentUserId;
    }

protected toChannelSuggestion(
        id: string,
        label: string,
    ): ComposeTargetSuggestion {
        return {
            kind: 'channel',
            id,
            label: `#${label}`,
            value: `#${id}`,
            subtitle: `Channel: #${id}`,
        };
    }

protected toUserSuggestion(user: User): ComposeTargetSuggestion {
        return {
            kind: 'user',
            id: user.id as string,
            label: `@${user.displayName}`,
            value: `@${user.displayName}`,
            subtitle: user.email ?? '',
        };
    }

protected applyComposeSuggestions(entries: ComposeTargetSuggestion[]): void {
        this.composeTargetSuggestions = entries;
        this.showComposeTargetSuggestions = entries.length > 0;
        this.composeTargetActiveIndex = entries.length ? 0 : -1;
    }

protected hideComposeTargetSuggestions(): void {
        this.composeTargetSuggestions = [];
        this.showComposeTargetSuggestions = false;
        this.composeTargetActiveIndex = -1;
    }

protected resolveStableAuthUser(
        incomingUser: FirebaseUser | null,
    ): FirebaseUser | null {
        const inAppArea = this.router.url.startsWith('/app');
        if (!incomingUser) return this.resolveWhenIncomingMissing(inAppArea);
        if (!incomingUser.isAnonymous)
            return this.storeAndReturnUser(incomingUser);
        if (this.shouldReuseLastRegularUser(inAppArea))
            return this.lastStableUser;
        return this.storeAndReturnUser(incomingUser);
    }

protected deferUiUpdate(update: () => void): void {
        setTimeout(() => {
            update();
        }, 0);
    }

protected subscribeToUsers(): void {
        this.subscription.add(
            this.userService.getAllUsers().subscribe({
                next: (users: User[]) => this.buildUserMap(users),
            }),
        );
    }

protected buildUserMap(users: User[]): void {
        this.usersById = users.reduce<Record<string, User>>((acc, user) => {
            if (user.id) acc[user.id] = user;
            return acc;
        }, {});
        this.resolveCurrentDirectUserName();
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

protected handleRouteMessageError(error: unknown): void {
        console.error('[HOME ROUTE MESSAGE ERROR]', error);
        this.connectionHint = '';
        this.errorMessage = this.resolveLoadErrorMessage(error);
    }

protected resolveLoadErrorMessage(error: unknown): string {
        const code = this.extractFirebaseErrorCode(error);
        if (code === 'permission-denied')
            return 'Nachrichten konnten nicht geladen werden (Rechteproblem).';
        if (code === 'failed-precondition')
            return 'Nachrichten konnten nicht geladen werden (Index fehlt/noch im Aufbau).';
        return 'Nachrichten konnten nicht geladen werden.';
    }

protected extractFirebaseErrorCode(error: unknown): string {
        if (!error || typeof error !== 'object') return '';
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : '';
    }

protected handleRouteMessageContext(
        user: FirebaseUser | null,
        params: ParamMap,
    ): void {
        if (!user) {
            this.clearMessagesState();
            return;
        }

        this.loadMessagesForRoute(params);
    }
}
