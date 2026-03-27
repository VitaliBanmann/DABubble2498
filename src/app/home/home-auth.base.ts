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

    protected abstract get authService(): AuthService;
    protected abstract get router(): Router;
    protected abstract get ui(): UiStateService;

    protected abstract syncComposerState(): void;
    protected abstract markCurrentContextAsRead(): void;

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    protected subscribeToAuth(): void {
        this.subscription.add(
            this.authService.currentUser$.subscribe(
                (user: FirebaseUser | null) => this.handleAuthUserChange(user),
            ),
        );
    }

    protected handleAuthUserChange(incomingUser: FirebaseUser | null): void {
        const stableUser = this.resolveStableAuthUser(incomingUser);
        this.deferUiUpdate(() => this.applyStableAuthUser(stableUser));
    }

    protected applyStableAuthUser(stableUser: FirebaseUser | null): void {
        this.authResolved = true;
        this.activeAuthUser = stableUser;
        this.currentUserId = stableUser?.uid ?? null;
        this.canWrite =
            !!stableUser && !stableUser.isAnonymous && !!stableUser.uid;
        this.syncComposerState();
        this.markCurrentContextAsRead();
    }

    protected resolveStableAuthUser(
        incomingUser: FirebaseUser | null,
    ): FirebaseUser | null {
        const inAppArea = this.router.url.startsWith('/app');
        if (!incomingUser) return this.resolveWhenIncomingMissing(inAppArea);
        if (!incomingUser.isAnonymous) return this.storeAndReturnUser(incomingUser);
        if (this.shouldReuseLastRegularUser(inAppArea)) return this.lastStableUser;
        return this.storeAndReturnUser(incomingUser);
    }

    protected resolveWhenIncomingMissing(
        inAppArea: boolean,
    ): FirebaseUser | null {
        if (this.shouldReuseLastRegularUser(inAppArea)) return this.lastStableUser;
        this.lastStableUser = null;
        return null;
    }

    protected storeAndReturnUser(user: FirebaseUser): FirebaseUser {
        this.lastStableUser = user;
        return user;
    }

    protected shouldReuseLastRegularUser(inAppArea: boolean): boolean {
        return !!(
            inAppArea &&
            this.lastStableUser &&
            !this.lastStableUser.isAnonymous
        );
    }

    protected deferUiUpdate(update: () => void): void {
        setTimeout(() => update(), 0);
    }
}
