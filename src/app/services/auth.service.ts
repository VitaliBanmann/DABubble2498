import { Inject, Injectable, PLATFORM_ID, Optional } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  signInAnonymously,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  User
} from 'firebase/auth';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject: BehaviorSubject<User | null> = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: object,
    @Optional() private readonly auth: Auth | null
  ) {
    if (isPlatformBrowser(this.platformId) && this.auth) {
      this.initAuthState();
    }
  }

  private initAuthState(): void {
    if (!this.auth) {
      return;
    }

    getRedirectResult(this.auth)
      .then((result) => {
        if (result?.user) {
          console.log('[GOOGLE AUTH] ✅ Redirect result received for user:', result.user.email);
        }
      })
      .catch((error) => {
        if (error?.code === 'auth/no-auth-event') {
          return;
        }

        console.error('[GOOGLE AUTH] ❌ Redirect result error');
        console.error('[GOOGLE AUTH] Error code:', error?.code);
        console.error('[GOOGLE AUTH] Error message:', error?.message);
        console.error('[GOOGLE AUTH] Full error object:', error);
      });

    onAuthStateChanged(this.auth, (user) => {
      this.currentUserSubject.next(user);
    });
  }

  registerWithEmailAndPassword(email: string, password: string): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
    }

    // Security: trim and normalize email
    const normalizedEmail = (email ?? '').trim().toLowerCase();

    // Validate before sending to Firebase
    if (!normalizedEmail || normalizedEmail.length > 254) {
      return Promise.reject(new Error('Invalid email address'));
    }

    if (!password || password.length < 6 || password.length > 128) {
      return Promise.reject(new Error('Invalid password'));
    }

    return createUserWithEmailAndPassword(this.auth, normalizedEmail, password)
      .then(() => {
        console.log('[REGISTER] ✅ User registered successfully');
      })
      .catch((error) => {
        // Extract real error code from customData if Firebase hides it
        if (error?.customData?.message) {
          const match = error.customData.message.match(/auth\/[\w-]+/);
          if (match && match[0] !== error.code) {
            console.log('[REGISTER] Real error code:', match[0], '(was hidden as', error.code + ')');
            // Replace error code with the real one
            error.code = match[0];
          }
        }
        
        console.error('[REGISTER] ❌ Registration failed:', error.code);
        throw error;
      });
  }

  loginWithEmailAndPassword(email: string, password: string): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
    }

    // Security: trim and normalize email
    const normalizedEmail = (email ?? '').trim().toLowerCase();

    return signInWithEmailAndPassword(this.auth, normalizedEmail, password)
      .then(() => {
        console.log('User logged in successfully');
      })
      .catch((error) => {
        console.error('Login error:', error);
        throw error;
      });
  }

  loginWithGoogle(): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
    }

    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('Google login is only available in browser runtime.'));
    }

    console.log('[GOOGLE AUTH] Starting Google OAuth flow...');
    console.log('[GOOGLE AUTH] Current domain:', window.location.origin);
    console.log('[GOOGLE AUTH] Auth domain from Firebase:', this.auth.config?.authDomain);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    provider.addScope('email');
    provider.addScope('profile');

    console.log('[GOOGLE AUTH] Provider created with scopes: email, profile');
    console.log('[GOOGLE AUTH] Using redirect-only flow for maximum compatibility...');

    return signInWithRedirect(this.auth, provider);
  }

  loginAsGuest(): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
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

  sendPasswordResetEmail(email: string): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
    }

    const normalizedEmail = (email ?? '').trim().toLowerCase();

    if (!normalizedEmail || normalizedEmail.length > 254) {
      return Promise.reject(new Error('Invalid email address'));
    }

    return sendPasswordResetEmail(this.auth, normalizedEmail)
      .then(() => {
        console.log('[PASSWORD RESET] ✅ Password reset email sent to:', normalizedEmail);
      })
      .catch((error) => {
        console.error('[PASSWORD RESET] ❌ Failed:', error.code);
        throw error;
      });
  }

  logout(): Promise<void> {
    if (!this.auth) {
      return Promise.reject(new Error('Auth is not available on the server.'));
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

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }
}
