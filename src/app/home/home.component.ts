import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    OnInit,
    QueryList,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';

import { ChannelPopupComponent } from '../layout/shell/channel-popup/channel-popup.component';
import { AddMemberToChannelComponent } from '../layout/shell/add-member-to-channel/add-member-to-channel.component';
import { ChannelMembersPopupComponent } from '../layout/shell/channel-members-popup/channel-members-popup.component';
import { AttachmentService } from '../services/attachment.service';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import { ChannelService } from '../services/channel.service';
import { Message, MessageService } from '../services/message.service';
import { UiStateService } from '../services/ui-state.service';
import { UnreadStateService } from '../services/unread-state.service';
import { UserService } from '../services/user.service';
import { HomeDisplayBase } from './home-display.base';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        PickerComponent,
        FormsModule,
        ChannelPopupComponent,
        AddMemberToChannelComponent,
        ChannelMembersPopupComponent,
    ],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent extends HomeDisplayBase implements OnInit, OnDestroy {
    [key: string]: any;

    readonly messageControl = new FormControl('', { nonNullable: true });

    @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;
    @ViewChild('channelTitleTrigger') channelTitleTriggerRef?: ElementRef<HTMLElement>;
    @ViewChild('membersAvatarTrigger') membersAvatarTriggerRef?: ElementRef<HTMLElement>;
    @ViewChild('composerTextarea') composerTextareaRef?: ElementRef<HTMLTextAreaElement>;
    @ViewChildren('editMessageTextarea') editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    constructor(
        private readonly _authFlow: AuthFlowService,
        private readonly _authService: AuthService,
        private readonly _attachmentService: AttachmentService,
        private readonly _messageService: MessageService,
        private readonly _userService: UserService,
        private readonly _route: ActivatedRoute,
        private readonly _router: Router,
        private readonly _ui: UiStateService,
        private readonly _unreadStateService: UnreadStateService,
        private readonly _cdr: ChangeDetectorRef,
        private readonly _channelService: ChannelService,
    ) {
        super();
    }

    /** Returns auth service. */
    protected override get authService(): AuthService { return this._authService; }
    /** Returns auth flow. */
    protected get authFlow(): AuthFlowService { return this._authFlow; }
    /** Returns user service. */
    protected override get userService(): UserService { return this._userService; }
    /** Returns channel service. */
    protected override get channelService(): ChannelService { return this._channelService; }
    /** Returns route. */
    protected override get route(): ActivatedRoute { return this._route; }
    /** Returns message service. */
    protected override get messageService(): MessageService { return this._messageService; }
    /** Returns unread state service. */
    protected override get unreadStateService(): UnreadStateService { return this._unreadStateService; }
    /** Returns router. */
    protected override get router(): Router { return this._router; }
    /** Returns ui. */
    protected override get ui(): UiStateService { return this._ui; }
    /** Returns cdr. */
    protected get cdr(): ChangeDetectorRef { return this._cdr; }
    /** Returns attachment service. */
    protected override get attachmentService(): AttachmentService { return this._attachmentService; }

    /** Returns is compose mode. */
    override get isComposeMode(): boolean { return this._ui.isNewMessageOpen(); }
    /** Returns is thread panel open. */
    get isThreadPanelOpen(): boolean { return this._ui.isThreadOpen(); }

    /** Returns message control value. */
    override get messageControlValue(): string { return this.messageControl.value; }
    /** Handles set message control value. */
    override setMessageControlValue(value: string): void { this.messageControl.setValue(value); }

    /** Forces Angular to refresh the current view after optimistic state updates. */
    protected override triggerViewUpdate(): void {
        this.cdr.detectChanges();
    }

    /** Requests a UI refresh before deferred DOM work. */
    protected override requestUiRefresh(): void {
        this.cdr.detectChanges();
    }

    /** Handles ng on init. */
    ngOnInit(): void {
        this.ui.closeThread();
        this.initializeConversationFromSnapshot();
        this.subscribeToAuth();
        this.subscribeToUsers();
        this.subscribeToChannelsForSuggestions();
        this.subscribeToRouteMessages();
        this.subscribeToQueryParams();
        this.syncComposerState();
        setTimeout(() => this.resizeComposerTextarea(), 0);
    }

    /** Handles ng on destroy. */
    override ngOnDestroy(): void {
        this.threadSubscription?.unsubscribe();
        this.liveMessagesSubscription?.unsubscribe();
        this.currentChannelSubscription?.unsubscribe();
        super.ngOnDestroy();
    }

    /** Focuses an input/textarea with small retries so it also works after rerender/open animations. */
    private focusElementSoon(
        getElement: () => HTMLInputElement | HTMLTextAreaElement | null,
        attempts = 8,
    ): void {
        const run = (remaining: number) => {
            requestAnimationFrame(() => {
                const element = getElement();
                if (element) {
                    element.focus();

                    const value = element.value ?? '';
                    if ('setSelectionRange' in element) {
                        const end = value.length;
                        element.setSelectionRange(end, end);
                    }
                    return;
                }

                if (remaining > 1) {
                    setTimeout(() => run(remaining - 1), 50);
                }
            });
        };

        run(attempts);
    }

    /** Focuses the normal chat composer. */
    private focusComposerSoon(): void {
        this.focusElementSoon(
            () => this.composerTextareaRef?.nativeElement ?? null,
        );
    }

    /** Focuses the thread input. */
    private focusThreadComposerSoon(): void {
        this.focusElementSoon(() => {
            return (
                document.querySelector('.thread-composer input') as HTMLInputElement | null
            ) ?? (
                document.querySelector('.thread-composer textarea') as HTMLTextAreaElement | null
            );
        });
    }

    /** Handles direct chat switch. */
    protected override setupDirectMessages(userId: string, name: string): void {
        super.setupDirectMessages(userId, name);
        this.focusComposerSoon();
    }

    /** Handles channel switch. */
    protected override startResolvedChannelContext(
        channelId: string,
        requestedChannelId: string,
    ): void {
        super.startResolvedChannelContext(channelId, requestedChannelId);
        this.focusComposerSoon();
    }

    /** Handles opening a thread and focuses its reply input. */
    override openThreadForMessage(message: Message): void {
        super.openThreadForMessage(message);
        this.focusThreadComposerSoon();
    }

    /** Handles on document click. */
    @HostListener('document:click')
    onDocumentClick(): void {
        this.closeAllEmojiPickers();
        this.closeMobileMessageToolbar();
    }

    @HostListener('window:resize')
    onWindowResize(): void {
        this.updateChannelMembersPopupPosition();

        if (!this.isMobileToolbarMode()) {
            this.closeMobileMessageToolbar();
        }
    }

    @HostListener('window:scroll')
    onWindowScroll(): void {
        this.updateChannelMembersPopupPosition();
    }

    /** Handles on escape key. */
    @HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: Event): void {
        if (!this.activeEmojiPicker) return;
        event.preventDefault();
        this.closeAllEmojiPickers();
    }
}
