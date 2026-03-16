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
import { UserService } from './services/user.service';
import {
    AUTH_ERROR_MESSAGES,
    formatFallbackError,
    parseFirebaseError,
} from './app-auth.util';

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
        displayName: ['', [Validators.maxLength(30)]],
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
        private readonly userService: UserService,
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

    enterRegisterMode(): void {
        this.isRegisterMode = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    enterLoginMode(): void {
        this.isRegisterMode = false;
        this.errorMessage = '';
        this.successMessage = '';
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

        const { displayName, email, password } = this.readLoginCredentials();

        if (mode === 'register' && !this.isRegisterPasswordValid(password)) {
            this.errorMessage =
                'Das Passwort erfüllt nicht die Anforderungen für die Registrierung.';
            return;
        }

        if (mode === 'register' && !displayName) {
            this.errorMessage = 'Bitte gib einen Anzeigenamen ein.';
            this.displayNameControl.markAsTouched();
            return;
        }

        this.startSubmitting();
        await this.runSubmit(mode, displayName, email, password);
    }

    private async runSubmit(
        mode: 'login' | 'register',
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        try {
            await this.authenticate(mode, displayName, email, password);
        } catch (error) {
            this.errorMessage = this.resolveSubmitError(mode, error);
        } finally {
            this.isSubmitting = false;
        }
    }

    private ensureValidLoginForm(): boolean {
        if (!this.loginForm.invalid) return true;
        this.loginForm.markAllAsTouched();
        return false;
    }

    private startSubmitting(): void {
        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    private readLoginCredentials(): {
        displayName: string;
        email: string;
        password: string;
    } {
        return {
            displayName: (this.loginForm.value.displayName ?? '').trim(),
            email: (this.loginForm.value.email ?? '').trim(),
            password: this.loginForm.value.password ?? '',
        };
    }

    private isRegisterPasswordValid(password: string): boolean {
        return (
            password.length >= 8 &&
            /[A-ZÄÖÜ]/.test(password) &&
            /[^A-Za-z0-9]/.test(password)
        );
    }

    private async authenticate(
        mode: 'login' | 'register',
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        if (mode === 'login') {
            await this.loginUser(email, password);
            return;
        }

        await this.registerUser(displayName, email, password);
    }

    private async loginUser(email: string, password: string): Promise<void> {
        await this.authService.loginWithEmailAndPassword(email, password);
        this.successMessage = 'Angemeldet.';
        await this.authFlow.syncEmailFromAuth(email);
        await this.authFlow.navigateAfterLogin();
    }

    private async registerUser(
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        await this.authService.registerWithEmailAndPassword(email, password);

        await this.userService.updateCurrentUserProfile({
            displayName,
            email,
        });

        this.successMessage = 'Konto erfolgreich erstellt.';
        await this.authFlow.syncEmailFromAuth(email);
        await this.authFlow.navigateAfterLogin();
    }

    private resolveSubmitError(mode: 'login' | 'register', error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            mode === 'login'
                ? 'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.'
                : 'Registrierung fehlgeschlagen. Bitte versuche es erneut.',
        );
    }

    get emailControl() {
        return this.loginForm.controls.email;
    }

    get passwordControl() {
        return this.loginForm.controls.password;
    }

    get displayNameControl() {
        return this.loginForm.controls.displayName;
    }

    get passwordChecks() {
        const value = this.passwordControl.value ?? '';
        return {
            minLength: value.length >= 8,
            uppercase: /[A-ZÄÖÜ]/.test(value),
            specialChar: /[^A-Za-z0-9]/.test(value),
        };
    }

    get passwordErrorMessage(): string {
        const password = this.passwordControl.value ?? '';

        if (!password) {
            return this.isRegisterMode
                ? 'Bitte gib ein Passwort ein.'
                : 'Bitte gib dein Passwort ein.';
        }

        if (this.isRegisterMode && !this.isRegisterPasswordValid(password)) {
            return 'Das Passwort muss mindestens 8 Zeichen, 1 Großbuchstaben und 1 Sonderzeichen enthalten.';
        }

        if (password.length < 6) {
            return 'Das Passwort muss mindestens 6 Zeichen lang sein.';
        }

        return '';
    }

    get showPasswordError(): boolean {
        const password = this.passwordControl.value ?? '';
        return this.passwordControl.touched && (
            this.passwordControl.invalid ||
            (this.isRegisterMode && !!password && !this.isRegisterPasswordValid(password))
        );
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
        return this.getAuthErrorMessage(error, 'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
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
        if (!this.forgotPasswordForm.invalid) return true;
        this.forgotPasswordForm.markAllAsTouched();
        return false;
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
        const { code, message } = parseFirebaseError(error);
        if (!code) return message ? `${fallback} (${message})` : fallback;

        const mapped = AUTH_ERROR_MESSAGES[code];
        if (mapped) {
            return mapped;
        }

        return formatFallbackError(fallback, code, message);
    }
}
