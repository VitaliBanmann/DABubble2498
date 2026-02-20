import { Component } from '@angular/core';
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

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly authService: AuthService,
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
      
      // If user is logged in AND on home/protected route → hide auth screen
      // Otherwise → always show auth screen
      const isOnProtectedRoute = ['/home', '/impressum', '/datenschutz'].some(route =>
        this.router.url.startsWith(route)
      );
      
      if (user && isOnProtectedRoute) {
        console.log('[AUTH STATE] User authenticated + on protected route → hiding auth screen');
        this.showAuthScreen = false;
      } else {
        console.log('[AUTH STATE] User NOT authenticated or on auth route → showing auth screen');
        this.showAuthScreen = true;
      }
    });

    // Also update on route changes
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        console.log('[ROUTE CHANGE]', event.urlAfterRedirects);
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
        await this.authService.loginWithEmailAndPassword(email, password);
        this.successMessage = 'Erfolgreich angemeldet.';
        this.isRegisterMode = false;
      } else {
        // Register with sanitized data
        await this.authService.registerWithEmailAndPassword(email, password);
        this.successMessage = 'Konto wurde erstellt. Du bist jetzt angemeldet.';
        this.isRegisterMode = false;
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
