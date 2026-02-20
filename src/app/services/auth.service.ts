import { Inject, Injectable, PLATFORM_ID, Optional } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth } from '@angular/fire/auth';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
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
        console.log('User registered successfully');
      })
      .catch((error) => {
        console.error('Registration error:', error);
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

    console.log('[GOOGLE AUTH] Starting Google OAuth flow...');
    console.log('[GOOGLE AUTH] Current domain:', window.location.origin);
    console.log('[GOOGLE AUTH] Auth domain from Firebase:', this.auth.config?.authDomain);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    provider.addScope('email');
    provider.addScope('profile');

    console.log('[GOOGLE AUTH] Provider created with scopes: email, profile');

    return signInWithPopup(this.auth, provider)
      .then((result) => {
        console.log('[GOOGLE AUTH] ✅ User logged in with Google successfully');
        console.log('[GOOGLE AUTH] User:', result.user.email);
      })
      .catch((error) => {
        console.error('[GOOGLE AUTH] ❌ Google popup login error:', error.code, error.message);
        
        // More specific error debugging
        switch (error.code) {
          case 'auth/popup-closed-by-user':
            console.error('[GOOGLE AUTH] Popup was closed by user or blocked by browser');
            break;
          case 'auth/popup-blocked':
            console.error('[GOOGLE AUTH] Popup was blocked - check browser popup settings');
            break;
          case 'auth/operation-not-allowed':
            console.error('[GOOGLE AUTH] Operation not allowed - check Firebase settings');
            break;
          case 'auth/unauthorized-domain':
            console.error('[GOOGLE AUTH] Current domain not authorized in Firebase');
            console.error('[GOOGLE AUTH] Current domain:', window.location.origin);
            break;
          default:
            console.error('[GOOGLE AUTH] Unknown error:', error);
        }
        
        throw error;
      });
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
