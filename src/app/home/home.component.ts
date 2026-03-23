import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    OnDestroy,
    OnInit,
    QueryList,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { User as FirebaseUser } from 'firebase/auth';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';
import { ChannelPopupComponent } from '../layout/shell/channel-popup/channel-popup.component';
import { AttachmentService } from '../services/attachment.service';
import { AuthFlowService } from '../services/auth-flow.service';
import { AuthService } from '../services/auth.service';
import { Channel, ChannelService } from '../services/channel.service';
import {
    Message,
    MessageAttachment,
    MessageReaction,
    MessageService,
    ThreadMessage,
} from '../services/message.service';
import { UiStateService } from '../services/ui-state.service';
import { UnreadStateService } from '../services/unread-state.service';
import { User, UserService } from '../services/user.service';
import {
    ComposeTargetSuggestion,
    MentionCandidate,
    MessageGroup,
} from './home.component.models';
import { HomeComponentBase7 } from './home.component.base7';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        PickerComponent,
        FormsModule,
        ChannelPopupComponent,
    ],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent extends HomeComponentBase7 implements OnInit, OnDestroy {
    readonly messageControl = new FormControl('', { nonNullable: true });
    readonly threadMessageControl = new FormControl('', { nonNullable: true });
    readonly composeTargetControl = new FormControl('', { nonNullable: true });
    readonly editMessageControl = new FormControl('', { nonNullable: true });

    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };
    readonly channelDescriptions: Record<string, string> = {
        allgemein:
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
        entwicklerteam:
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
    };

    private readonly composerMinHeightPx = 145;
    private readonly composerMaxHeightPx = 180;
    private readonly pageSize = 30;
    private readonly maxAttachmentSizeBytes = 10 * 1024 * 1024;
    private readonly messageGroupWindowMs = 5 * 60 * 1000;
    private readonly nearBottomThresholdPx = 200;
    private readonly authRegressionWindowMs = 2000;
    private readonly allowedAttachmentMimeTypes = new Set<string>([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
    ]);

    @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;
    @ViewChild('channelTitleTrigger')
    channelTitleTriggerRef?: ElementRef<HTMLElement>;
    @ViewChild('composerTextarea')
    composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

    @ViewChildren('editMessageTextarea')
    editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    get currentChannelDescription(): string {
        return (
            this.channelDescriptions[this.currentChannelId] ??
            'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.'
        );
    }

    private composeResolvedTarget:
        | { kind: 'channel'; channelId: string }
        | { kind: 'user'; userId: string }
        | null = null;

    composeTargetSuggestions: ComposeTargetSuggestion[] = [];
    composeTargetActiveIndex = -1;
    showComposeTargetSuggestions = false;

    currentChannelId = 'allgemein';
    currentDirectUserId = '';
    currentDirectUserName = '';
    isDirectMessage = false;

    messages: Message[] = [];
    threadMessages: ThreadMessage[] = [];
    messageGroups: MessageGroup[] = [];
    activeThreadParent: Message | null = null;

    errorMessage = '';
    connectionHint = '';

    mentionSuggestions: MentionCandidate[] = [];
    showMentionSuggestions = false;
    private selectedMentions = new Map<string, MentionCandidate>();

    selectedAttachments: File[] = [];
    attachmentError = '';

    private hasSentWelcomeMessage = false;
    isSending = false;
    isThreadSending = false;
    isLoadingMoreMessages = false;
    hasMoreMessages = true;
    canWrite = false;
    authResolved = false;
    showScrollToLatestButton = false;
    isChannelPopupOpen = false;
    channelPopupLeft = 24;
    channelPopupTop = 100;
    editingMessageId: string | null = null;
    isSavingEdit = false;

    private expandedReactionMessages = new Set<string>();
    private seededChannels = new Set<string>();
    private currentUserId: string | null = null;
    private usersById: Record<string, User> = {};

    private readonly subscription = new Subscription();
    private threadSubscription: Subscription | null = null;
    private liveMessagesSubscription: Subscription | null = null;
    private currentChannelSubscription: Subscription | null = null;

    private liveMessages: Message[] = [];
    private olderMessages: Message[] = [];

    private activeAuthUser: FirebaseUser | null = null;
    private lastStableUser: FirebaseUser | null = null;
    private lastRegularUserAt = 0;

    private pendingScrollToMessageId: string | null = null;
    private forceScrollToBottomOnNextRender = true;
    private pendingOlderScrollRestore: {
        previousScrollTop: number;
        previousScrollHeight: number;
    } | null = null;
    private lastRenderedMessageKey = '';

    activeEmojiPicker:
        | { type: 'composer' }
        | { type: 'message'; messageId: string }
        | null = null;

    currentChannel: Channel | null = null;
    readonly maxVisibleChannelMembers = 3;

    constructor(
        protected readonly authFlow: AuthFlowService,
        protected readonly authService: AuthService,
        protected readonly attachmentService: AttachmentService,
        protected readonly messageService: MessageService,
        protected readonly userService: UserService,
        protected readonly route: ActivatedRoute,
        protected readonly router: Router,
        protected readonly ui: UiStateService,
        protected readonly unreadStateService: UnreadStateService,
        protected readonly cdr: ChangeDetectorRef,
        protected readonly channelService: ChannelService,
    ) {
        super();
    }
}
