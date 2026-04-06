import { Inject, Injectable, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { PresenceStatus, UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class PresenceService implements OnDestroy {
    private readonly subscription = new Subscription();
    private started = false;
    private heartbeatId: ReturnType<typeof setInterval> | null = null;
    private readonly visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
            void this.setStatus('online');
        } else {
            void this.setStatus('away');
        }
    };

    private readonly beforeUnloadHandler = () => {
        void this.setStatus('offline');
    };

    constructor(
        @Inject(PLATFORM_ID) private readonly platformId: object,
        private readonly authService: AuthService,
        private readonly userService: UserService,
    ) {}

    /** Handles start tracking. */
    startTracking(): void {
        if (!isPlatformBrowser(this.platformId) || this.started) {
            return;
        }

        this.started = true;

        this.subscription.add(
            this.authService.currentUser$.subscribe((user) => {
                if (!user || user.isAnonymous) {
                    this.stopHeartbeat();
                    this.removeBrowserListeners();
                    return;
                }

                this.attachBrowserListeners();
                void this.setStatus('online');
                this.startHeartbeat();
            }),
        );
    }

    /** Handles set status. */
    async setStatus(status: PresenceStatus): Promise<void> {
        try {
            await this.userService.updateCurrentUserPresence(status);
        } catch {
            // no-op: presence should not break user flow
        }
    }

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.stopHeartbeat();
        this.removeBrowserListeners();
        this.subscription.unsubscribe();
    }

    /** Handles start heartbeat. */
    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatId = setInterval(() => {
            const nextStatus: PresenceStatus =
                document.visibilityState === 'visible' ? 'online' : 'away';
            void this.setStatus(nextStatus);
        }, 45000);
    }

    /** Handles stop heartbeat. */
    private stopHeartbeat(): void {
        if (this.heartbeatId) {
            clearInterval(this.heartbeatId);
            this.heartbeatId = null;
        }
    }

    /** Handles attach browser listeners. */
    private attachBrowserListeners(): void {
        window.addEventListener('visibilitychange', this.visibilityHandler);
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    /** Handles remove browser listeners. */
    private removeBrowserListeners(): void {
        window.removeEventListener('visibilitychange', this.visibilityHandler);
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }
}
