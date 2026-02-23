import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { User } from 'firebase/auth';
import { take } from 'rxjs';
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  showSplash = true;
  showAuthScreen = true; // Default: ALWAYS show auth screen
  isRegisterMode = false; // Toggle between login and register
  showLoginPassword = false; // Toggle password visibility for login
  showRegisterPassword = false; // Toggle password visibility for register
  loginForm;
  registerForm;
  isSubmitting = false;
  errorMessage = '';
  successMessage = '';
  currentDomain = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  private readonly legalRoutes = ['/impressum', '/datenschutz'];
  private isProfileCheckInProgress = false;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly router: Router
  ) {
    console.log('[INIT] AppComponent constructor - showAuthScreen:', this.showAuthScreen);
    
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false]
    });

    this.registerForm = this.formBuilder.group({
      fullName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      privacyAccepted: [false, Validators.requiredTrue]
    });

    // Hide splash screen after animation
    setTimeout(() => {
      this.showSplash = false;
      console.log('[TIMEOUT 3800ms] showSplash set to false');
    }, 3800);

    // Track auth state changes
    this.authService.currentUser$.subscribe((user) => {
      console.log('[AUTH STATE] User changed:', user?.email ?? 'null (not logged in)');
      console.log('[AUTH STATE] Current showAuthScreen:', this.showAuthScreen);
      console.log('[AUTH STATE] Current router.url:', this.router.url);

      this.updateAuthScreenVisibility(user, this.router.url);
    });

    // Also update on route changes
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        console.log('[ROUTE CHANGE]', event.urlAfterRedirects);
        this.updateAuthScreenVisibility(this.authService.getCurrentUser(), event.urlAfterRedirects);
      }
    });
  }

  private updateAuthScreenVisibility(user: User | null, url: string): void {
    const isLegalRoute = this.legalRoutes.some(route => url.startsWith(route));

    if (isLegalRoute) {
      this.showAuthScreen = false;
      console.log('[AUTH STATE] Legal route detected → hiding auth screen');
      return;
    }

    if (!user) {
      this.showAuthScreen = true;
      console.log('[AUTH STATE] Showing auth screen');
      return;
    }

    this.showAuthScreen = false;
    this.routeAuthenticatedUser(user, url);
  }

  private routeAuthenticatedUser(user: User, url: string): void {
    if (this.isProfileCheckInProgress) {
      return;
    }

    this.isProfileCheckInProgress = true;

    this.userService.getUser(user.uid).pipe(take(1)).subscribe({
      next: (profile) => {
        const hasAvatar = Boolean(profile?.avatar);
        const isHomeRoute = url.startsWith('/home');
        const isAvatarRoute = url.startsWith('/avatar-select');

        if (!hasAvatar && !isAvatarRoute) {
          void this.router.navigateByUrl('/avatar-select');
          return;
        }

        if (hasAvatar && !(isHomeRoute || isAvatarRoute)) {
          void this.router.navigateByUrl('/home');
        }
      },
      error: () => {
        if (!url.startsWith('/avatar-select')) {
          void this.router.navigateByUrl('/avatar-select');
        }
        this.isProfileCheckInProgress = false;
      },
      complete: () => {
        this.isProfileCheckInProgress = false;
      }
    });
  }

  async onSubmit(mode: 'login' | 'register'): Promise<void> {
    const form = mode === 'login' ? this.loginForm : this.registerForm;
    
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    const email = (form.value.email ?? '').trim().toLowerCase();
    const password = form.value.password ?? '';

    try {
      if (mode === 'login') {
        await this.withTimeout(
          this.authService.loginWithEmailAndPassword(email, password),
          15000,
          'Anmeldung dauert zu lange. Bitte erneut versuchen.'
        );
        this.successMessage = 'Erfolgreich angemeldet.';
        this.isRegisterMode = false;
        // Wait for onAuthStateChanged listener to process the new session
        await this.delay(500);
      } else {
        // Register with sanitized data
        await this.withTimeout(
          this.authService.registerWithEmailAndPassword(email, password),
          15000,
          'Registrierung dauert zu lange. Bitte erneut versuchen.'
        );
        this.successMessage = 'Konto wurde erstellt. Du bist jetzt angemeldet.';
        this.isRegisterMode = false;
        // Wait for onAuthStateChanged listener to process the new session
        await this.delay(500);
      }
    } catch (error) {
      this.errorMessage = mode === 'login'
        ? this.getAuthErrorMessage(error, 'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.')
        : this.getAuthErrorMessage(error, 'Registrierung fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      this.isSubmitting = false;
    }
  }

  get emailControl() {
    return this.loginForm.controls.email;
  }

  get passwordControl() {
    return this.loginForm.controls.password;
  }

  get fullNameControl() {
    return this.registerForm.controls.fullName;
  }

  get registerEmailControl() {
    return this.registerForm.controls.email;
  }

  get registerPasswordControl() {
    return this.registerForm.controls.password;
  }

  get privacyControl() {
    return this.registerForm.controls.privacyAccepted;
  }

  async onGoogleLogin(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    const resetTimer = window.setTimeout(() => {
      if (this.isSubmitting) {
        this.isSubmitting = false;
        this.errorMessage = 'Google-Anmeldung konnte nicht gestartet werden. Bitte erneut versuchen.';
      }
    }, 8000);

    try {
      await this.withTimeout(
        this.authService.loginWithGoogle(),
        10000,
        'Google-Anmeldung konnte nicht gestartet werden. Bitte erneut versuchen.'
      );
      this.successMessage = 'Erfolgreich mit Google angemeldet.';
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(error, 'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      window.clearTimeout(resetTimer);
      this.isSubmitting = false;
    }
  }

  async onGuestLogin(): Promise<void> {
    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.withTimeout(
        this.authService.loginAsGuest(),
        15000,
        'Gast-Anmeldung dauert zu lange. Bitte erneut versuchen.'
      );
      this.successMessage = 'Erfolgreich als Gast angemeldet.';
      // Wait for onAuthStateChanged listener to process the new session
      await this.delay(500);
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(error, 'Gast-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      this.isSubmitting = false;
    }
  }

  async onForgotPassword(): Promise<void> {
    const email = this.loginForm.controls.email.value?.trim();

    if (!email) {
      this.errorMessage = 'Bitte gib deine E-Mail-Adresse ein, um dein Passwort zurückzusetzen.';
      return;
    }

    if (this.loginForm.controls.email.invalid) {
      this.errorMessage = 'Bitte gib eine gültige E-Mail-Adresse ein.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.sendPasswordResetEmail(email);
      this.successMessage = `Eine E-Mail zum Zurücksetzen deines Passworts wurde an ${email} gesendet. Bitte überprüfe dein Postfach.`;
      this.loginForm.controls.email.reset();
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(
        error, 
        'Passwort-Reset fehlgeschlagen. Bitte versuche es erneut.'
      );
    } finally {
      this.isSubmitting = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getAuthErrorMessage(error: unknown, fallback: string): string {
    const firebaseError = error as { code?: string; message?: string } | null;
    const code = firebaseError?.code ?? '';
    const message = firebaseError?.message ?? '';

    if (!code) {
      return message ? `${fallback} (${message})` : fallback;
    }

    switch (code) {
      case 'auth/email-already-in-use':
        return 'Diese E-Mail ist bereits registriert. Bitte melde dich an oder nutze "Passwort vergessen".';
      case 'auth/user-not-found':
        return 'Kein Konto mit dieser E-Mail gefunden. Bitte überprüfe die E-Mail-Adresse oder registriere dich.';
      case 'auth/invalid-email':
        return 'Ungültige E-Mail-Adresse. Bitte überprüfe deine Eingabe.';
      case 'auth/missing-email':
        return 'Bitte gib eine E-Mail-Adresse ein.';
      case 'auth/wrong-password':
        return 'Falsches Passwort. Bitte versuche es erneut oder nutze "Passwort vergessen".';
      case 'auth/invalid-credential':
        return 'Ungültige Anmeldedaten. Bitte überprüfe E-Mail und Passwort.';
      case 'auth/network-request-failed':
        return 'Netzwerk-/API-Fehler bei Firebase. Bitte prüfe Firebase Authentication API, Identity Toolkit API und API-Key-Domainfreigaben.';
      case 'auth/popup-closed-by-user':
        return 'Google-Popup wurde geschlossen. Bitte erneut versuchen.';
      case 'auth/popup-blocked':
        return 'Popup wurde blockiert. Bitte Popup-Blocker deaktivieren und erneut versuchen.';
      case 'auth/unauthorized-domain':
        return 'Domain nicht autorisiert. Bitte Firebase Authorized Domains prüfen.';
      case 'auth/operation-not-allowed':
        return 'Anmeldemethode ist in Firebase nicht aktiviert.';
      case 'auth/admin-restricted-operation':
        return 'Diese Anmeldung ist aktuell eingeschränkt. Firebase-Konfiguration prüfen.';
      default:
        return message ? `${fallback} (${code}: ${message})` : `${fallback} (${code})`;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          window.clearTimeout(timerId);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timerId);
          reject(error);
        });
    });
  }
}
