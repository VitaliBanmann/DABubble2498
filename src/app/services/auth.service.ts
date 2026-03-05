import {
    Inject,
    Injectable,
    NgZone,
    OnDestroy,
    PLATFORM_ID,
    Optional,
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
    public authReady$: Observable<boolean> = this.authReadySubject.asObservable();

    constructor(
        @Inject(PLATFORM_ID) private readonly platformId: object,
        @Optional() private readonly auth: Auth | null,
        private readonly zone: NgZone,
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
        this.unsubscribeAuthState = onAuthStateChanged(this.auth, async (user) => {
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
        });
    }

    registerWithEmailAndPassword(
        email: string,
        password: string,
    ): Promise<void> {
        return this.runAuthAction(
            () =>
                createUserWithEmailAndPassword(
                    this.getRequiredAuth(),
                    email,
                    password,
                ),
            'User registered successfully',
            'Registration error:',
        );
    }

    loginWithEmailAndPassword(email: string, password: string): Promise<void> {
        return this.runAuthAction(
            () =>
                signInWithEmailAndPassword(
                    this.getRequiredAuth(),
                    email,
                    password,
                ),
            'User logged in successfully',
            'Login error:',
            (error) => this.logInvalidCredentials(error),
        );
    }

    async loginWithGoogle(): Promise<{ email: string | null }> {
        const credential = await signInWithPopup(this.getRequiredAuth(), this.createGoogleProvider());
        console.log('User logged in with Google successfully');
        return { email: credential.user.email };
    }

    loginAsGuest(): Promise<void> {
        return this.runAuthAction(
            () => signInAnonymously(this.getRequiredAuth()),
            'User logged in as guest successfully',
            'Guest login error:',
        );
    }

    logout(): Promise<void> {
        return this.runAuthAction(
            () => signOut(this.getRequiredAuth()),
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
            () => confirmPasswordReset(this.getRequiredAuth(), code, newPassword),
            'Password reset successful',
            'Password reset error:',
        );
    }

    getCurrentUser(): User | null {
        return this.currentUserSubject.value;
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
            .then(action)
            .then(() => {
                console.log(successMessage);
            })
            .catch((error) => {
                beforeErrorLog?.(error);
                if (error?.code !== 'auth/invalid-credential') {
                    console.error(errorMessage, error);
                }
                throw error;
            });
    }

    private logInvalidCredentials(error: { code?: string }): void {
        if (error?.code === 'auth/invalid-credential') {
            console.info('Login failed: invalid credentials');
        }
    }
}
