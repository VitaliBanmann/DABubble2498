import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
    NavigationEnd,
    Router,
    RouterLink,
    RouterOutlet,
} from '@angular/router';
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
    showPassword = false;
    showForgotPasswordOverlay = false;

    loginForm = this.formBuilder.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(6)]],
        rememberMe: [false],
    });

    forgotPasswordForm = this.formBuilder.group({
        email: ['', [Validators.required, Validators.email]],
    });

    isSubmitting = false;
    errorMessage = '';
    successMessage = '';
    forgotPasswordMessage = '';
    forgotPasswordError = '';

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
                await this.authService.loginWithEmailAndPassword(
                    email,
                    password,
                );
                this.successMessage = 'Angemeldet.';
            } else {
                await this.authService.registerWithEmailAndPassword(
                    email,
                    password,
                );
                this.successMessage = 'Konto erfolgreich erstellt.';
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

    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    async onGoogleLogin(): Promise<void> {
        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';

        try {
            await this.authService.loginWithGoogle();
            this.successMessage = 'Erfolgreich mit Google angemeldet.';
            void this.router.navigateByUrl('/avatar-select');
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

    openForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
        // E-Mail aus Login-Form übernehmen falls vorhanden
        const loginEmail = this.loginForm.value.email?.trim() || '';
        this.forgotPasswordForm.patchValue({ email: loginEmail });
    }

    closeForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = false;
        this.forgotPasswordForm.reset();
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
    }

    async sendPasswordResetEmail(): Promise<void> {
        if (this.forgotPasswordForm.invalid) {
            this.forgotPasswordForm.markAllAsTouched();
            return;
        }

        this.isSubmitting = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';

        const email = (this.forgotPasswordForm.value.email ?? '').trim();

        try {
            await this.authService.sendPasswordResetEmail(email);
            this.forgotPasswordMessage = 'E-Mail gesendet. Bitte überprüfe dein Postfach.';
            // Overlay nach 3 Sekunden schließen
            setTimeout(() => {
                this.closeForgotPasswordOverlay();
            }, 3000);
        } catch (error) {
            this.forgotPasswordError = this.getAuthErrorMessage(
                error,
                'Fehler beim Senden der E-Mail. Bitte versuche es erneut.',
            );
        } finally {
            this.isSubmitting = false;
        }
    }

    get forgotPasswordEmailControl() {
        return this.forgotPasswordForm.controls.email;
    }

    private getAuthErrorMessage(error: unknown, fallback: string): string {
        const firebaseError = error as {
            code?: string;
            message?: string;
        } | null;
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
                return message
                    ? `${fallback} (${code}: ${message})`
                    : `${fallback} (${code})`;
        }
    }
}
