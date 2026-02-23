import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  showSplash = true;
  showAuthScreen = true;

  loginForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    rememberMe: [false],
  });

  isSubmitting = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone,
  ) {
    // Splash ausblenden (zuverlässig, auch wenn Angular/Zone mal "spinnt")
    setTimeout(() => {
      this.ngZone.run(() => {
        this.showSplash = false;
        this.cdr.detectChanges();
      });
    }, 3500);

    // initial
    this.updateAuthScreenVisibility(this.router.url);

    // route changes
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateAuthScreenVisibility(event.urlAfterRedirects);
      }
    });

    // auth state
    this.authService.currentUser$.subscribe((user) => {
      if (!user) {
        return;
      }

      // Wenn User eingeloggt und noch auf "/" ist -> ab in die App Shell
      const pathname = (this.router.url || '').split('?')[0];
      if (pathname === '/' || pathname === '') {
        void this.router.navigateByUrl('/app');
      }
    });
  }

  private updateAuthScreenVisibility(url: string): void {
    const pathname = (url || '').split('?')[0];

    // Auth-Screen NUR auf "/"
    this.showAuthScreen = pathname === '/' || pathname === '';
  }

  async onSubmit(mode: 'login' | 'register'): Promise<void> {
    // Hinweis: dein aktuelles Template nutzt onSubmit('register') für "Konto erstellen".
    // Solange ihr noch keinen separaten Register-Form habt, behandeln wir register wie login,
    // oder du deaktivierst den Button später.
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    const email = (this.loginForm.value.email ?? '').trim();
    const password = this.loginForm.value.password ?? '';

    try {
      if (mode === 'login') {
        await this.authService.loginWithEmailAndPassword(email, password);
        this.successMessage = 'Erfolgreich angemeldet.';
      } else {
        await this.authService.registerWithEmailAndPassword(email, password);
        this.successMessage = 'Konto wurde erstellt. Du bist jetzt angemeldet.';
      }

      // Direkt navigieren (zusätzlich zum Auth-State Listener)
      void this.router.navigateByUrl('/app');
    } catch (error) {
      this.errorMessage =
        mode === 'login'
          ? this.getAuthErrorMessage(
              error,
              'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.',
            )
          : this.getAuthErrorMessage(
              error,
              'Registrierung fehlgeschlagen. Bitte versuche es erneut.',
            );
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

  async onGoogleLogin(): Promise<void> {
    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.loginWithGoogle();
      this.successMessage = 'Erfolgreich mit Google angemeldet.';
      void this.router.navigateByUrl('/app');
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(
        error,
        'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
      );
    } finally {
      this.isSubmitting = false;
    }
  }

  async onGuestLogin(): Promise<void> {
    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.loginAsGuest();
      this.successMessage = 'Erfolgreich als Gast angemeldet.';
      void this.router.navigateByUrl('/app');
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(
        error,
        'Gast-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
      );
    } finally {
      this.isSubmitting = false;
    }
  }

  private getAuthErrorMessage(error: unknown, fallback: string): string {
    const firebaseError = error as { code?: string; message?: string } | null;
    const code = firebaseError?.code ?? '';
    const message = firebaseError?.message ?? '';

    if (!code) {
      return message ? `${fallback} (${message})` : fallback;
    }

    switch (code) {
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
      case 'auth/invalid-email':
        return 'Ungültige E-Mail-Adresse. Bitte überprüfe deine Eingabe.';
      case 'auth/wrong-password':
        return 'Falsches Passwort. Bitte versuche es erneut.';
      case 'auth/user-not-found':
        return 'Kein Konto mit dieser E-Mail gefunden.';
      case 'auth/email-already-in-use':
        return 'Diese E-Mail ist bereits registriert.';
      case 'auth/network-request-failed':
        return 'Netzwerkfehler. Bitte Internet/Firebase-Setup prüfen.';
      default:
        return message ? `${fallback} (${code}: ${message})` : `${fallback} (${code})`;
    }
  }
}