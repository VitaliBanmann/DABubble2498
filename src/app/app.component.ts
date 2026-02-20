import { Component, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  showSplash = true;
  showAuthScreen = true;
  loginForm;
  isSubmitting = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly ngZone: NgZone,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false]
    });

    // Clear auth cache if on root path (fresh login)
    if (window.location.pathname === '/' || window.location.pathname === '') {
      console.log('[DEBUG] Clearing cache - on root path');
      localStorage.clear();
      sessionStorage.clear();
    }
    console.log('[DEBUG] AppComponent init - window.location:', {
      pathname: window.location.pathname,
      routerUrl: this.router.url
    });

    // Hide splash screen after animation
    console.log('[DEBUG] Starting 3800ms timeout...');
    setTimeout(() => {
      console.log('[DEBUG] TIMEOUT FIRED!');
      this.showSplash = false;
      this.cdr.detectChanges();
      console.log('[DEBUG] showSplash set to false, change detection triggered');
      console.log('[DEBUG] Current values:', { showSplash: this.showSplash, showAuthScreen: this.showAuthScreen });
    }, 3800);
    console.log('[DEBUG] Timeout scheduled, current showSplash:', this.showSplash);

    this.updateAuthScreenVisibility(this.router.url);

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateAuthScreenVisibility(event.urlAfterRedirects);
      }
    });

    // Delay to allow splash animation to finish
    setTimeout(() => {
      console.log('[DEBUG] Auth subscription starting...');
      this.authService.currentUser$.subscribe((user) => {
        console.log('[DEBUG] currentUser$ fired:', user?.email ?? 'null');
        if (!user) {
          console.log('[DEBUG] No user, staying on login screen');
          return;
        }

        if (this.router.url === '/' || this.router.url === '') {
          console.log('[DEBUG] User logged in, redirecting to /avatar-select');
          this.router.navigateByUrl('/avatar-select');
        }
      });
    }, 4000);
  }

  private updateAuthScreenVisibility(url: string): void {
    const pathname = this.normalizePathname(url);
    const appRouteSegment = pathname.split('/').filter(Boolean).at(-1) ?? '';
    const isAppContentRoute = ['home', 'impressum', 'datenschutz'].includes(appRouteSegment);
    this.showAuthScreen = !isAppContentRoute;
    
    console.log('[DEBUG] updateAuthScreenVisibility:', {
      url,
      pathname,
      appRouteSegment,
      isAppContentRoute,
      showAuthScreen: this.showAuthScreen
    });
  }

  private normalizePathname(url: string): string {
    const rawPath = (url || '').split('?')[0].trim();

    if (!rawPath || rawPath === '/') {
      return '/';
    }

    const withoutIndex = rawPath.replace(/\/index\.html$/i, '');
    const withoutTrailingSlash = withoutIndex.replace(/\/+$/, '');

    return withoutTrailingSlash || '/';
  }

  async onSubmit(mode: 'login' | 'register'): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    const email = this.loginForm.value.email ?? '';
    const password = this.loginForm.value.password ?? '';

    try {
      if (mode === 'login') {
        await this.authService.loginWithEmailAndPassword(email, password);
        this.successMessage = 'Erfolgreich angemeldet.';
      } else {
        await this.authService.registerWithEmailAndPassword(email, password);
        this.successMessage = 'Konto wurde erstellt. Du bist jetzt angemeldet.';
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

  async onGoogleLogin(): Promise<void> {
    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.loginWithGoogle();
      this.successMessage = 'Erfolgreich mit Google angemeldet.';
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(error, 'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
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
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(error, 'Gast-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
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
      default:
        return message ? `${fallback} (${code}: ${message})` : `${fallback} (${code})`;
    }
  }
}
