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
import { MessageService } from '../services/message.service';
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

    protected override get authService(): AuthService { return this._authService; }
    protected get authFlow(): AuthFlowService { return this._authFlow; }
    protected override get userService(): UserService { return this._userService; }
    protected override get channelService(): ChannelService { return this._channelService; }
    protected override get route(): ActivatedRoute { return this._route; }
    protected override get messageService(): MessageService { return this._messageService; }
    protected override get unreadStateService(): UnreadStateService { return this._unreadStateService; }
    protected override get router(): Router { return this._router; }
    protected override get ui(): UiStateService { return this._ui; }
    protected get cdr(): ChangeDetectorRef { return this._cdr; }
    protected override get attachmentService(): AttachmentService { return this._attachmentService; }

    override get isComposeMode(): boolean { return this._ui.isNewMessageOpen(); }
    get isThreadPanelOpen(): boolean { return this._ui.isThreadOpen(); }

    override get messageControlValue(): string { return this.messageControl.value; }
    override setMessageControlValue(value: string): void { this.messageControl.setValue(value); }

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

    override ngOnDestroy(): void {
        this.threadSubscription?.unsubscribe();
        this.liveMessagesSubscription?.unsubscribe();
        this.currentChannelSubscription?.unsubscribe();
        super.ngOnDestroy();
    }

    @HostListener('document:click')
    onDocumentClick(): void { this.closeAllEmojiPickers(); }

    @HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: Event): void {
        if (!this.activeEmojiPicker) return;
        event.preventDefault();
        this.closeAllEmojiPickers();
    }
}
