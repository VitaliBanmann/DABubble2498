import {
    EnvironmentInjector,
    Inject,
    Injectable,
    NgZone,
    OnDestroy,
    PLATFORM_ID,
    Optional,
    runInInjectionContext,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signInAnonymously,
    GoogleAuthProvider,
    signOut,
    sendPasswordResetEmail,
    confirmPasswordReset,
    onAuthStateChanged,
    User,
} from 'firebase/auth';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class AuthService implements OnDestroy {
    private unsubscribeAuthState?: () => void;
    private currentUserSubject: BehaviorSubject<User | null> =
        new BehaviorSubject<User | null>(null);
    public currentUser$: Observable<User | null> =
        this.currentUserSubject.asObservable();
    private authReadySubject = new BehaviorSubject<boolean>(false);
    public authReady$: Observable<boolean> =
        this.authReadySubject.asObservable();

    constructor(
        @Inject(PLATFORM_ID) private readonly platformId: object,
        @Optional() private readonly auth: Auth | null,
        private readonly zone: NgZone,
        private readonly injector: EnvironmentInjector,
    ) {
        if (isPlatformBrowser(this.platformId) && this.auth) {
            this.initAuthState();
        }
    }

    private initAuthState(): void {
        if (!this.auth) {
            return;
        }

        this.unsubscribeAuthState?.();
        let hasEmittedReady = false;
        this.unsubscribeAuthState = runInInjectionContext(this.injector, () =>
            onAuthStateChanged(
                this.auth!,
                async (user) => {
                    if (user) {
                        try {
                            await user.getIdToken();
                        } catch {
                            // ignore: we still emit auth state, Firestore might retry
                        }
                    }

                    this.zone.run(() => {
                        this.currentUserSubject.next(user);
                        if (!hasEmittedReady) {
                            hasEmittedReady = true;
                            this.authReadySubject.next(true);
                        }
                    });
                },
            ),
        );
    }

    registerWithEmailAndPassword(
        email: string,
        password: string,
    ): Promise<void> {
        return this.runAuthAction(
            async () => {
                await this.resetAnonymousSessionIfNeeded();
                const credential = await this.createUserWithEmail(email, password);
                this.ensureNotAnonymous(credential.user.isAnonymous);
                this.emitCurrentUser(credential.user);
            },
            'User registered successfully',
            'Registration error:',
        );
    }

    loginWithEmailAndPassword(email: string, password: string): Promise<void> {
        return this.runAuthAction(
            async () => {
                await this.resetAnonymousSessionIfNeeded();
                const credential = await this.signInWithEmail(email, password);
                this.ensureNotAnonymous(credential.user.isAnonymous);
                this.emitCurrentUser(credential.user);
            },
            'User logged in successfully',
            'Login error:',
            (error) => this.logInvalidCredentials(error),
        );
    }

    private signInWithEmail(email: string, password: string) {
        return runInInjectionContext(this.injector, () =>
            signInWithEmailAndPassword(this.getRequiredAuth(), email, password),
        );
    }

    private createUserWithEmail(email: string, password: string) {
        return runInInjectionContext(this.injector, () =>
            createUserWithEmailAndPassword(this.getRequiredAuth(), email, password),
        );
    }

    async loginWithGoogle(): Promise<{ email: string | null }> {
        await this.resetAnonymousSessionIfNeeded();
        const credential = await runInInjectionContext(this.injector, () =>
            signInWithPopup(this.getRequiredAuth(), this.createGoogleProvider()),
        );
        this.ensureNotAnonymous(credential.user.isAnonymous);
        this.emitCurrentUser(credential.user);
        return { email: this.resolveUserEmail(credential.user) };
    }

    private async resetAnonymousSessionIfNeeded(): Promise<void> {
        const activeUser = this.getCurrentUser();
        if (!activeUser?.isAnonymous) {
            return;
        }

        await runInInjectionContext(this.injector, () =>
            signOut(this.getRequiredAuth()),
        );
        this.emitCurrentUser(null);
    }

    private ensureNotAnonymous(isAnonymous: boolean): void {
        if (isAnonymous) {
            throw new Error(
                'Google login failed: anonymous session still active.',
            );
        }
    }

    loginAsGuest(): Promise<void> {
        return this.runAuthAction(
            async () => {
                const credential = await signInAnonymously(
                    this.getRequiredAuth(),
                );
                this.emitCurrentUser(credential.user);
            },
            'User logged in as guest successfully',
            'Guest login error:',
        );
    }

    logout(): Promise<void> {
        return this.runAuthAction(
            async () => {
                await signOut(this.getRequiredAuth());
                this.emitCurrentUser(null);
            },
            'User logged out successfully',
            'Logout error:',
        );
    }

    sendPasswordResetEmail(email: string): Promise<void> {
        return this.runAuthAction(
            () => sendPasswordResetEmail(this.getRequiredAuth(), email),
            'Password reset email sent successfully',
            'Password reset email error:',
        );
    }

    confirmPasswordReset(code: string, newPassword: string): Promise<void> {
        return this.runAuthAction(
            () =>
                confirmPasswordReset(this.getRequiredAuth(), code, newPassword),
            'Password reset successful',
            'Password reset error:',
        );
    }

    getCurrentUser(): User | null {
        return this.currentUserSubject.value ?? this.auth?.currentUser ?? null;
    }

    ngOnDestroy(): void {
        this.unsubscribeAuthState?.();
    }

    private getRequiredAuth(): Auth {
        if (!this.auth) {
            throw new Error('Auth is not available on the server.');
        }

        return this.auth;
    }

    private createGoogleProvider(): GoogleAuthProvider {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        provider.addScope('email');
        provider.addScope('profile');
        return provider;
    }

    private runAuthAction(
        action: () => Promise<unknown>,
        successMessage: string,
        errorMessage: string,
        beforeErrorLog?: (error: any) => void,
    ): Promise<void> {
        return Promise.resolve()
            .then(() => runInInjectionContext(this.injector, action))
            .then(() => {})
            .catch((error) => {
                beforeErrorLog?.(error);
                if (error?.code !== 'auth/invalid-credential') {
                    console.error(errorMessage, error);
                }
                throw error;
            });
    }

    private emitCurrentUser(user: User | null): void {
        this.zone.run(() => {
            this.currentUserSubject.next(user);
        });
    }

    private resolveUserEmail(user: User | null): string | null {
        if (!user) {
            return null;
        }

        const direct = (user.email ?? '').trim();
        if (direct) {
            return direct;
        }

        return this.resolveProviderEmail(user.providerData);
    }

    private resolveProviderEmail(
        providers: Array<{ email: string | null }>,
    ): string | null {
        const fromProvider = providers.find(
            (provider) => (provider.email ?? '').trim().length > 0,
        )?.email;
        return (fromProvider ?? '').trim() || null;
    }

    private logInvalidCredentials(error: { code?: string }): void {
        if (error?.code === 'auth/invalid-credential') {
            console.info('Login failed: invalid credentials');
        }
    }
}
