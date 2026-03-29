import { Injectable, signal } from '@angular/core';
import { Message, ThreadMessage } from './message.models';

@Injectable({ providedIn: 'root' })
export class UiStateService {
    // Sidebar state (Workspace menu)
    readonly isSidebarOpen = signal(true);

    // Thread panel state (context-based)
    readonly isThreadOpen = signal(false);
    readonly activeThreadParent = signal<Message | null>(null);
    readonly threadMessages = signal<ThreadMessage[]>([]);

    // Optional: store selected thread context later (messageId, channelId)
    // readonly activeThread = signal<{ channelId: string; messageId: string } | null>(null);

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

    openThread(): void {
        this.isThreadOpen.set(true);
    }

    closeThread(): void {
        this.isThreadOpen.set(false);
        this.clearThreadContext();
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
