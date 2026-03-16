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
import {FormControl, FormsModule, ReactiveFormsModule} from '@angular/forms';
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


import { HomeComponentBase7 } from './home.component.base7';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, PickerComponent, FormsModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent extends HomeComponentBase7 implements OnInit, OnDestroy {
    readonly messageControl = new FormControl('', { nonNullable: true });

    readonly threadMessageControl = new FormControl('', { nonNullable: true });

    readonly channelNames: Record<string, string> = {
            allgemein: 'Allgemein',
            entwicklerteam: 'Entwicklerteam',
        };

    readonly composeTargetControl = new FormControl('', { nonNullable: true });

    private readonly composerMinHeightPx = 145;

    private readonly composerMaxHeightPx = 180;

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

    canWrite = false;

    private expandedReactionMessages = new Set<string>();

    private seededChannels = new Set<string>();

    private currentUserId: string | null = null;

    private usersById: Record<string, User> = {};

    private readonly subscription = new Subscription();

    private threadSubscription: Subscription | null = null;

    private liveMessagesSubscription: Subscription | null = null;

    private liveMessages: Message[] = [];

    private olderMessages: Message[] = [];

    private readonly pageSize = 30;

    private readonly maxAttachmentSizeBytes = 10 * 1024 * 1024;

    private readonly messageGroupWindowMs = 5 * 60 * 1000;

    private readonly allowedAttachmentMimeTypes = new Set<string>([
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
        ]);

    isLoadingMoreMessages = false;

    hasMoreMessages = true;

    private activeAuthUser: FirebaseUser | null = null;

    private lastStableUser: FirebaseUser | null = null;

    private readonly authRegressionWindowMs = 2000;

    private lastRegularUserAt = 0;

    authResolved = false;

    constructor(
            private readonly authFlow: AuthFlowService,
            private readonly authService: AuthService,
            private readonly attachmentService: AttachmentService,
            private readonly messageService: MessageService,
            private readonly userService: UserService,
            private readonly route: ActivatedRoute,
            private readonly router: Router,
            private readonly ui: UiStateService,
            private readonly unreadStateService: UnreadStateService,
            private readonly cdr: ChangeDetectorRef,
        ) {
        super();
    }

    @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;

    @ViewChild('composerTextarea') composerTextareaRef?: ElementRef<HTMLTextAreaElement>;

    showScrollToLatestButton = false;

    private pendingScrollToMessageId: string | null = null;

    private readonly nearBottomThresholdPx = 200;

    private forceScrollToBottomOnNextRender = true;

    private pendingOlderScrollRestore: {
            previousScrollTop: number;
            previousScrollHeight: number;
        } | null = null;

    private lastRenderedMessageKey = '';

    editingMessageId: string | null = null;

    readonly editMessageControl = new FormControl('', { nonNullable: true });

    isSavingEdit = false;

    @ViewChildren('editMessageTextarea')
        editMessageTextareas?: QueryList<ElementRef<HTMLTextAreaElement>>;

    activeEmojiPicker:
            | { type: 'composer' }
            | { type: 'message'; messageId: string }
            | null = null;

    @HostListener('document:click')
    override onDocumentClick(): void {
        super.onDocumentClick();
    }

    @HostListener('document:keydown.escape', ['$event'])
    override onEscapeKey(event: Event): void {
        super.onEscapeKey(event);
    }
}
