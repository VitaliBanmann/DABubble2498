import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
    NavigationEnd,
    Router,
    RouterLink,
    RouterOutlet,
} from '@angular/router';
import { AuthFlowService } from './services/auth-flow.service';
import { AuthService } from './services/auth.service';
import { PresenceService } from './services/presence.service';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
    'auth/popup-closed-by-user':
        'Google-Popup wurde geschlossen. Bitte erneut versuchen.',
    'auth/popup-blocked':
        'Popup wurde blockiert. Bitte Popup-Blocker deaktivieren und erneut versuchen.',
    'auth/unauthorized-domain':
        'Domain nicht autorisiert. Bitte Firebase Authorized Domains prüfen.',
    'auth/operation-not-allowed':
        'Anmeldemethode ist in Firebase nicht aktiviert.',
    'auth/admin-restricted-operation':
        'Diese Anmeldung ist aktuell eingeschränkt. Firebase-Konfiguration prüfen.',
    'auth/invalid-email':
        'Ungültige E-Mail-Adresse. Bitte überprüfe deine Eingabe.',
    'auth/wrong-password': 'Falsches Passwort. Bitte versuche es erneut.',
    'auth/user-not-found': 'Kein Konto mit dieser E-Mail gefunden.',
    'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
    'auth/network-request-failed':
        'Netzwerkfehler. Bitte Internet/Firebase-Setup prüfen.',
};

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
    isRegisterMode = false;

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
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly presenceService: PresenceService,
        private readonly router: Router,
        private readonly cdr: ChangeDetectorRef,
        private readonly ngZone: NgZone,
    ) {
        this.presenceService.startTracking();

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
            void this.authFlow.handleAuthState(user, this.router.url);
        });
    }

    private updateAuthScreenVisibility(url: string): void {
        const pathname = (url || '').split('?')[0];

        // Auth-Screen NUR auf "/"
        this.showAuthScreen = pathname === '/' || pathname === '';
    }

    async onSubmit(mode: 'login' | 'register'): Promise<void> {
        this.isRegisterMode = mode === 'register';
        if (!this.ensureValidLoginForm()) {
            return;
        }

        const { email, password } = this.readLoginCredentials();
        this.startSubmitting();
        await this.runSubmit(mode, email, password);
    }

    private async runSubmit(
        mode: 'login' | 'register',
        email: string,
        password: string,
    ): Promise<void> {
        try {
            await this.authenticate(mode, email, password);
        } catch (error) {
            this.errorMessage = this.resolveSubmitError(mode, error);
        } finally {
            this.isSubmitting = false;
        }
    }

    private ensureValidLoginForm(): boolean {
        if (this.loginForm.invalid) {
            this.loginForm.markAllAsTouched();
            return false;
        }
        return true;
    }

    private startSubmitting(): void {
        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    private readLoginCredentials(): { email: string; password: string } {
        return {
            email: (this.loginForm.value.email ?? '').trim(),
            password: this.loginForm.value.password ?? '',
        };
    }

    private async authenticate(
        mode: 'login' | 'register',
        email: string,
        password: string,
    ): Promise<void> {
        if (mode === 'login') {
            await this.loginUser(email, password);
            return;
        }

        await this.registerUser(email, password);
    }

    private async loginUser(email: string, password: string): Promise<void> {
        await this.authService.loginWithEmailAndPassword(email, password);
        this.successMessage = 'Angemeldet.';
        await this.authFlow.syncEmailFromAuth(email);
        await this.authFlow.navigateAfterLogin();
    }

    private async registerUser(email: string, password: string): Promise<void> {
        await this.authService.registerWithEmailAndPassword(email, password);
        this.successMessage = 'Konto erfolgreich erstellt.';
        await this.authFlow.syncEmailFromAuth(email);
        await this.authFlow.navigateAfterLogin();
    }

    private resolveSubmitError(mode: 'login' | 'register', error: unknown): string {
        if (mode === 'login') {
            return this.getAuthErrorMessage(
                error,
                'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.',
            );
        }

        return this.getAuthErrorMessage(
            error,
            'Registrierung fehlgeschlagen. Bitte versuche es erneut.',
        );
    }

    get emailControl() {
        return this.loginForm.controls.email;
    }

    get passwordControl() {
        return this.loginForm.controls.password;
    }

    get passwordChecks() {
        const value = this.passwordControl.value ?? '';
        return {
            minLength: value.length >= 8,
            uppercase: /[A-ZÄÖÜ]/.test(value),
            specialChar: /[^A-Za-z0-9]/.test(value),
        };
    }

    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    async onGoogleLogin(): Promise<void> {
        this.startSubmitting();

        try {
            await this.loginWithGoogleAndNavigate();
        } catch (error) {
            this.errorMessage = this.resolveGoogleError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    private async loginWithGoogleAndNavigate(): Promise<void> {
        const result = await this.authService.loginWithGoogle();
        this.successMessage = 'Erfolgreich mit Google angemeldet.';
        await this.authFlow.syncEmailFromAuth(result.email ?? '');
        await this.authFlow.navigateAfterLogin();
    }

    private resolveGoogleError(error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
        );
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
        if (!this.ensureValidResetForm()) {
            return;
        }

        this.startResetSubmitting();
        await this.executeResetRequest();
    }

    private ensureValidResetForm(): boolean {
        if (this.forgotPasswordForm.invalid) {
            this.forgotPasswordForm.markAllAsTouched();
            return false;
        }
        return true;
    }

    private startResetSubmitting(): void {
        this.isSubmitting = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
    }

    private async executeResetRequest(): Promise<void> {
        const email = (this.forgotPasswordForm.value.email ?? '').trim();
        try {
            await this.authService.sendPasswordResetEmail(email);
            this.handleResetSuccess();
        } catch (error) {
            this.forgotPasswordError = this.resolveResetError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    private handleResetSuccess(): void {
        this.forgotPasswordMessage = 'E-Mail gesendet. Bitte überprüfe dein Postfach.';
        setTimeout(() => this.closeForgotPasswordOverlay(), 3000);
    }

    private resolveResetError(error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            'Fehler beim Senden der E-Mail. Bitte versuche es erneut.',
        );
    }

    get forgotPasswordEmailControl() {
        return this.forgotPasswordForm.controls.email;
    }

    private getAuthErrorMessage(error: unknown, fallback: string): string {
        const { code, message } = this.parseFirebaseError(error);
        if (!code) {
            return message ? `${fallback} (${message})` : fallback;
        }

        const mapped = AUTH_ERROR_MESSAGES[code];
        if (mapped) {
            return mapped;
        }

        return this.formatFallbackError(fallback, code, message);
    }

    private formatFallbackError(fallback: string, code: string, message: string): string {
        return message ? `${fallback} (${code}: ${message})` : `${fallback} (${code})`;
    }

    private parseFirebaseError(error: unknown): { code: string; message: string } {
        const firebaseError = error as {
            code?: string;
            message?: string;
        } | null;

        return {
            code: firebaseError?.code ?? '',
            message: firebaseError?.message ?? '',
        };
    }

}
