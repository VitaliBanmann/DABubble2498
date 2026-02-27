import {
    Inject,
    Injectable,
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

    constructor(
        @Inject(PLATFORM_ID) private readonly platformId: object,
        @Optional() private readonly auth: Auth | null,
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
        this.unsubscribeAuthState = onAuthStateChanged(this.auth, (user) => {
            this.currentUserSubject.next(user);
        });
    }

    registerWithEmailAndPassword(
        email: string,
        password: string,
    ): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return createUserWithEmailAndPassword(this.auth, email, password)
            .then(() => {
                console.log('User registered successfully');
            })
            .catch((error) => {
                console.error('Registration error:', error);
                throw error;
            });
    }

    loginWithEmailAndPassword(email: string, password: string): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return signInWithEmailAndPassword(this.auth, email, password)
            .then(() => {
                console.log('User logged in successfully');
            })
            .catch((error) => {
                if (error?.code === 'auth/invalid-credential') {
                    console.info('Login failed: invalid credentials');
                } else {
                    console.error('Login error:', error);
                }
                throw error;
            });
    }

    loginWithGoogle(): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        provider.addScope('email');
        provider.addScope('profile');

        return signInWithPopup(this.auth, provider)
            .then(() => {
                console.log('User logged in with Google successfully');
            })
            .catch((error) => {
                console.error('Google popup login error:', error);
                throw error;
            });
    }

    loginAsGuest(): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return signInAnonymously(this.auth)
            .then(() => {
                console.log('User logged in as guest successfully');
            })
            .catch((error) => {
                console.error('Guest login error:', error);
                throw error;
            });
    }

    logout(): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return signOut(this.auth)
            .then(() => {
                console.log('User logged out successfully');
            })
            .catch((error) => {
                console.error('Logout error:', error);
                throw error;
            });
    }

    sendPasswordResetEmail(email: string): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return sendPasswordResetEmail(this.auth, email)
            .then(() => {
                console.log('Password reset email sent successfully');
            })
            .catch((error) => {
                console.error('Password reset email error:', error);
                throw error;
            });
    }

    confirmPasswordReset(code: string, newPassword: string): Promise<void> {
        if (!this.auth) {
            return Promise.reject(
                new Error('Auth is not available on the server.'),
            );
        }

        return confirmPasswordReset(this.auth, code, newPassword)
            .then(() => {
                console.log('Password reset successful');
            })
            .catch((error) => {
                console.error('Password reset error:', error);
                throw error;
            });
    }

    getCurrentUser(): User | null {
        return this.currentUserSubject.value;
    }

    ngOnDestroy(): void {
        this.unsubscribeAuthState?.();
    }
}
