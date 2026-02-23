import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiStateService {
    // Sidebar state (Workspace menu)
    readonly isSidebarOpen = signal(true);

    // Thread panel state (context-based)
    readonly isThreadOpen = signal(false);

    // Optional: store selected thread context later (messageId, channelId)
    // readonly activeThread = signal<{ channelId: string; messageId: string } | null>(null);

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
    }

    // For later:
    // openThreadFor(channelId: string, messageId: string): void {
    //   this.activeThread.set({ channelId, messageId });
    //   this.isThreadOpen.set(true);
    // }
}
