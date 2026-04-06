import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { User as FirebaseUser } from 'firebase/auth';
import { Subscription } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UiStateService } from '../services/ui-state.service';

@Injectable()
export abstract class HomeAuthBase implements OnDestroy {
    authResolved = false;
    canWrite = false;
    currentUserId: string | null = null;

    protected activeAuthUser: FirebaseUser | null = null;
    protected lastStableUser: FirebaseUser | null = null;
    private lastRegularUserAt = 0;
    protected readonly authRegressionWindowMs = 2000;
    protected readonly subscription = new Subscription();

    /** Returns auth service. */
    protected abstract get authService(): AuthService;
    /** Returns router. */
    protected abstract get router(): Router;
    /** Returns ui. */
    protected abstract get ui(): UiStateService;

    /** Handles sync composer state. */
    protected abstract syncComposerState(): void;
    /** Handles mark current context as read. */
    protected abstract markCurrentContextAsRead(): void;

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    /** Handles subscribe to auth. */
    protected subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe(
                (user: FirebaseUser | null) => this.handleAuthUserChange(user),
            ),
        );
    }

    /** Handles handle auth user change. */
    protected handleAuthUserChange(incomingUser: FirebaseUser | null): void {
        const stableUser = this.resolveStableAuthUser(incomingUser);
        this.deferUiUpdate(() => this.applyStableAuthUser(stableUser));
    }

    /** Handles apply stable auth user. */
    protected applyStableAuthUser(stableUser: FirebaseUser | null): void {
        this.authResolved = true;
        this.activeAuthUser = stableUser;
        this.currentUserId = stableUser?.uid ?? null;
        this.canWrite =
            !!stableUser && !stableUser.isAnonymous && !!stableUser.uid;
        this.syncComposerState();
        this.markCurrentContextAsRead();
    }

    /** Handles resolve stable auth user. */
    protected resolveStableAuthUser(
        incomingUser: FirebaseUser | null,
    ): FirebaseUser | null {
        const inAppArea = this.router.url.startsWith('/app');
        if (!incomingUser) return this.resolveWhenIncomingMissing(inAppArea);
        if (!incomingUser.isAnonymous) return this.storeAndReturnUser(incomingUser);
        if (this.shouldReuseLastRegularUser(inAppArea)) return this.lastStableUser;
        return this.storeAndReturnUser(incomingUser);
    }

    /** Handles resolve when incoming missing. */
    protected resolveWhenIncomingMissing(
        inAppArea: boolean,
    ): FirebaseUser | null {
        if (this.shouldReuseLastRegularUser(inAppArea)) return this.lastStableUser;
        this.lastStableUser = null;
        return null;
    }

    /** Handles store and return user. */
    protected storeAndReturnUser(user: FirebaseUser): FirebaseUser {
        this.lastStableUser = user;
        return user;
    }

    /** Handles should reuse last regular user. */
    protected shouldReuseLastRegularUser(inAppArea: boolean): boolean {
        return !!(
            inAppArea &&
            this.lastStableUser &&
            !this.lastStableUser.isAnonymous
        );
    }

    /** Handles defer ui update. */
    protected deferUiUpdate(update: () => void): void {
        setTimeout(() => update(), 0);
    }
}
