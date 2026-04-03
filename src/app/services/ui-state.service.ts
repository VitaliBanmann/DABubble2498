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

    openNewMessage(): void {
        this.isNewMessageOpen.set(true);
    }

    closeNewMessage(): void {
        this.isNewMessageOpen.set(false);
    }

    toggleSidebar(): void {
        this.isSidebarOpen.update((v) => !v);
    }

    openSidebar(): void {
        this.isSidebarOpen.set(true);
    }

    closeSidebar(): void {
        this.isSidebarOpen.set(false);
    }

    openChat(): void {
        if (!this.isMobile()) return;
        this.closeSidebar();
        this.mobilePanel.set('chat');
    }

    goBackToSidebar(): void {
        this.openSidebar();
        this.mobilePanel.set('sidebar');
        if (this.isThreadOpen()) this.closeThread();
    }

    openThread(): void {
        this.isThreadOpen.set(true);
        this.mobilePanel.set('thread');
    }

    closeThread(): void {
        this.isThreadOpen.set(false);
        this.clearThreadContext();
        if (this.isMobile()) this.mobilePanel.set('chat');
    }

    setActiveThreadParent(message: Message | null): void {
        this.activeThreadParent.set(message);
    }

    setThreadMessages(messages: ThreadMessage[]): void {
        this.threadMessages.set(messages);
    }

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
