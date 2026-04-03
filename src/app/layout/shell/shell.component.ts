import { Component, OnDestroy, OnInit, computed } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { UiStateService } from '../../services/ui-state.service';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Message } from '../../services/message.models';
import { AuthService } from '../../services/auth.service';
import { User, UserService } from '../../services/user.service';
import { Subscription } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MessageService } from '../../services/message.service';

interface ThreadRenderMessage {
    id?: string;
    text: string;
    senderId: string;
    timestamp: Message['timestamp'];
    isParent: boolean;
}

@Component({
    selector: 'app-shell',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        RouterOutlet,
        SidebarComponent,
        TopbarComponent,
        MatIconModule,
    ],
    templateUrl: './shell.component.html',
    styleUrl: './shell.component.scss',
})
export class ShellComponent implements OnInit, OnDestroy {
    private readonly subscriptions = new Subscription();
    private usersById: Record<string, User> = {};
    private currentUserId: string | null = null;
    readonly threadReplyControl = new FormControl('', { nonNullable: true });
    isThreadSending = false;

    constructor(
        public readonly ui: UiStateService,
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly messageService: MessageService,
        private readonly router: Router,
    ) {}

    readonly classes = computed(() => ({
        'sidebar-open': this.ui.isSidebarOpen(),
        'thread-open': this.ui.isThreadOpen(),
        'mobile-panel-sidebar': this.ui.isMobile() && this.ui.mobilePanel() === 'sidebar',
        'mobile-panel-chat': this.ui.isMobile() && this.ui.mobilePanel() === 'chat',
        'mobile-panel-thread': this.ui.isMobile() && this.ui.mobilePanel() === 'thread',
    }));

    openNewMessageMobile(): void {
        this.ui.openNewMessage();
        this.ui.openChat();
        void this.router.navigate(['/app/channel/allgemein']);
    }

    ngOnInit(): void {
        this.currentUserId = this.authService.getCurrentUser()?.uid ?? null;
        this.subscriptions.add(
            this.authService.currentUser$.subscribe((user) => {
                this.currentUserId = user?.uid ?? null;
            }),
        );
        this.subscriptions.add(
            this.userService.getAllUsersRealtime().subscribe((users) => {
                this.usersById = users.reduce<Record<string, User>>((acc, user) => {
                    if (!user.id) return acc;
                    acc[user.id] = user;
                    return acc;
                }, {});
            }),
        );
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
    }

    threadDisplayMessages(): ThreadRenderMessage[] {
        const parent = this.ui.activeThreadParent();
        const replies = this.ui.threadMessages();
        if (!parent) return [];

        const parentItem: ThreadRenderMessage = {
            id: parent.id,
            text: parent.text,
            senderId: parent.senderId,
            timestamp: parent.timestamp,
            isParent: true,
        };

        const replyItems = replies.map((reply) => ({
            id: reply.id,
            text: reply.text,
            senderId: reply.senderId,
            timestamp: reply.timestamp,
            isParent: false,
        }));

        return [parentItem, ...replyItems];
    }

    isOwnThreadMessage(message: ThreadRenderMessage): boolean {
        return !!this.currentUserId && message.senderId === this.currentUserId;
    }

    getThreadSenderLabel(message: ThreadRenderMessage): string {
        if (this.isOwnThreadMessage(message)) return 'Du';
        return this.usersById[message.senderId]?.displayName ?? message.senderId;
    }

    getThreadAvatar(message: ThreadRenderMessage): string {
        const fallback = 'assets/pictures/profile.svg';
        const raw = (this.usersById[message.senderId]?.avatar ?? '').trim();
        if (!raw) return fallback;
        if (this.isExternalAvatar(raw) || this.isAssetAvatar(raw)) return raw;
        return `assets/pictures/${raw}`;
    }

    formatThreadTimestamp(timestamp: Message['timestamp']): string {
        const date = this.toDate(timestamp);
        if (!date) return '';
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    trackThreadMessage(index: number, message: ThreadRenderMessage): string {
        if (message.id) return message.id;
        const ts = this.resolveTrackTimestamp(message.timestamp, index);
        return `${message.senderId}-${ts}-${message.text}`;
    }

    sendThreadReply(): void {
        if (this.isThreadSending) return;

        const parent = this.ui.activeThreadParent();
        const parentId = parent?.id ?? '';
        const senderId = this.currentUserId ?? '';
        const text = this.threadReplyControl.value.trim();
        if (!parentId || !senderId || !text) return;

        this.isThreadSending = true;
        this.messageService.sendChannelThreadMessage(parentId, text, senderId).subscribe({
            next: () => {
                this.threadReplyControl.setValue('');
                this.isThreadSending = false;
            },
            error: (error: unknown) => {
                console.error('[THREAD SEND ERROR]', error);
                this.isThreadSending = false;
            },
        });
    }

    private resolveTrackTimestamp(timestamp: Message['timestamp'], fallback: number): number {
        if (timestamp instanceof Date) return timestamp.getTime();
        if ('toMillis' in timestamp && typeof (timestamp as any).toMillis === 'function') {
            return (timestamp as any).toMillis();
        }
        return fallback;
    }

    private toDate(value: unknown): Date | null {
        if (!value) return null;
        if (value instanceof Date) return this.asValidDate(value);
        if (
            typeof value === 'object' &&
            !!value &&
            'toDate' in value &&
            typeof (value as any).toDate === 'function'
        ) {
            return this.asValidDate((value as any).toDate());
        }
        return null;
    }

    private asValidDate(value: Date): Date | null {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    private isExternalAvatar(value: string): boolean {
        return ['http://', 'https://', 'data:', 'blob:'].some((prefix) => value.startsWith(prefix));
    }

    private isAssetAvatar(value: string): boolean {
        return value.startsWith('/assets/') || value.startsWith('assets/');
    }
}
