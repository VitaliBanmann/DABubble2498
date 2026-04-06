import { Injectable, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Message, ThreadMessage } from './message.models';

@Injectable({ providedIn: 'root' })
export class UiStateService {
    readonly isMobile = toSignal(
        inject(BreakpointObserver)
            .observe('(max-width: 767px)')
            .pipe(map((r) => r.matches)),
        { initialValue: false },
    );

    readonly mobilePanel = signal<'sidebar' | 'chat' | 'thread'>('sidebar');

    // Sidebar state (Workspace menu)
    readonly isSidebarOpen = signal(true);

    // Thread panel state (context-based)
    readonly isThreadOpen = signal(false);
    readonly activeThreadParent = signal<Message | null>(null);
    readonly threadMessages = signal<ThreadMessage[]>([]);

    readonly isNewMessageOpen = signal(false);

    /** Handles open new message. */
    openNewMessage(): void {
        this.isNewMessageOpen.set(true);
    }

    /** Handles close new message. */
    closeNewMessage(): void {
        this.isNewMessageOpen.set(false);
    }

    /** Handles toggle sidebar. */
    toggleSidebar(): void {
        this.isSidebarOpen.update((v) => !v);
    }

    /** Handles open sidebar. */
    openSidebar(): void {
        this.isSidebarOpen.set(true);
    }

    /** Handles close sidebar. */
    closeSidebar(): void {
        this.isSidebarOpen.set(false);
    }

    /** Handles open chat. */
    openChat(): void {
        if (!this.isMobile()) return;
        this.closeSidebar();
        this.mobilePanel.set('chat');
    }

    /** Handles go back to sidebar. */
    goBackToSidebar(): void {
        this.openSidebar();
        this.mobilePanel.set('sidebar');
        if (this.isThreadOpen()) this.closeThread();
    }

    /** Handles open thread. */
    openThread(): void {
        this.isThreadOpen.set(true);
        this.mobilePanel.set('thread');
    }

    /** Handles close thread. */
    closeThread(): void {
        const wasOpen = this.isThreadOpen();
        this.isThreadOpen.set(false);
        this.clearThreadContext();
        if (this.isMobile() && wasOpen) this.mobilePanel.set('chat');
    }

    /** Handles set active thread parent. */
    setActiveThreadParent(message: Message | null): void {
        this.activeThreadParent.set(message);
    }

    /** Handles set thread messages. */
    setThreadMessages(messages: ThreadMessage[]): void {
        this.threadMessages.set(messages);
    }

    /** Handles clear thread context. */
    clearThreadContext(): void {
        this.activeThreadParent.set(null);
        this.threadMessages.set([]);
    }

    // For later:
    // openThreadFor(channelId: string, messageId: string): void {
    //   this.activeThread.set({ channelId, messageId });
    //   this.isThreadOpen.set(true);
    // }
}
