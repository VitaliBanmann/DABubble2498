import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
    AUTH_ERROR_MESSAGES,
    formatFallbackError,
    parseFirebaseError,
} from './app-auth.util';
import { AuthFlowService } from './services/auth-flow.service';
import { AuthService } from './services/auth.service';
import { PasswordResetFlowService } from './services/password-reset-flow.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';

const STRICT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    isSubmitting = false;
    errorMessage = '';
    successMessage = '';
    forgotPasswordMessage = '';
    forgotPasswordError = '';

    loginFeedbackVisible = false;
    loginFeedbackMessage = '';
    loginFeedbackType: 'loading' | 'success' | 'error' = 'loading';

    private loginFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

    loginForm = this.formBuilder.group({
        displayName: ['', [Validators.maxLength(30)]],
        email: [
            '',
            [Validators.required, Validators.email, Validators.pattern(STRICT_EMAIL_PATTERN)],
        ],
        password: ['', [Validators.required, Validators.minLength(6)]],
        rememberMe: [false],
    });

    forgotPasswordForm = this.formBuilder.group({
        email: [
            '',
            [Validators.required, Validators.email, Validators.pattern(STRICT_EMAIL_PATTERN)],
        ],
    });

    constructor(
        private readonly formBuilder: FormBuilder,
        private readonly authFlow: AuthFlowService,
        private readonly authService: AuthService,
        private readonly userService: UserService,
        readonly resetFlow: PasswordResetFlowService,
        private readonly presenceService: PresenceService,
        private readonly router: Router,
        private readonly cdr: ChangeDetectorRef,
        private readonly ngZone: NgZone,
    ) {
        this.presenceService.startTracking();

        setTimeout(() => {
            this.ngZone.run(() => {
                this.showSplash = false;
                this.cdr.detectChanges();
            });
        }, 3500);

        this.updateAuthScreenVisibility(this.router.url);
        this.handleResetLinkFromUrl(this.router.url);

        this.router.events.subscribe((event) => {
            if (!(event instanceof NavigationEnd)) return;
            this.updateAuthScreenVisibility(event.urlAfterRedirects);
            this.handleResetLinkFromUrl(event.urlAfterRedirects);
        });

        this.authService.currentUser$.subscribe((user) => {
            void this.authFlow.handleAuthState(user, this.router.url);
        });
    }

    /** Handles enter register mode. */
    enterRegisterMode(): void {
        this.isRegisterMode = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    /** Handles enter login mode. */
    enterLoginMode(): void {
        this.isRegisterMode = false;
        this.errorMessage = '';
        this.successMessage = '';
    }

    /** Handles on submit. */
    async onSubmit(mode: 'login' | 'register'): Promise<void> {
        this.isRegisterMode = mode === 'register';

        if (!this.ensureValidLoginForm()) return;

        const { displayName, email, password } = this.readLoginCredentials();

        if (!this.canSubmitRegister(mode, displayName, password)) return;

        await this.runSubmit(mode, displayName, email, password);
    }

    /** Handles password enter on login. */
    onPasswordEnter(event: Event): void {
        if (this.isRegisterMode || this.isSubmitting) return;
        event.preventDefault();
        void this.onSubmit('login');
    }

    /** Handles on google login. */
    async onGoogleLogin(): Promise<void> {
        this.startSubmitting();

        try {
            await this.runGoogleLogin();
        } catch (error) {
            this.errorMessage = this.resolveGoogleError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    /** Handles on guest login. */
    async onGuestLogin(): Promise<void> {
        this.startSubmitting();

        try {
            await this.runGuestLogin();
        } catch (error) {
            this.errorMessage = this.resolveGuestError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    /** Handles open forgot password overlay. */
    openForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';

        const loginEmail = this.loginForm.value.email?.trim() ?? '';
        this.forgotPasswordForm.patchValue({ email: loginEmail });
    }

    /** Handles close forgot password overlay. */
    closeForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = false;
        this.forgotPasswordForm.reset();
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
    }

    /** Handles send password reset email. */
    async sendPasswordResetEmail(): Promise<void> {
        if (!this.ensureValidResetForm()) return;

        const email = this.prepareResetEmailSubmit();

        try {
            await this.runSendResetEmail(email);
        } catch (error) {
            this.forgotPasswordError = this.resolveSendResetError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    /** Handles open reset password overlay. */
    openResetPasswordOverlay(code: string): void {
        this.showForgotPasswordOverlay = false;
        this.resetFlow.open(code);
    }

    /** Handles close reset password overlay. */
    closeResetPasswordOverlay(): void {
        this.resetFlow.close();

        void this.router.navigate([], {
            queryParams: { mode: null, oobCode: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    /** Handles confirm password reset from link. */
    async confirmPasswordResetFromLink(): Promise<void> {
        await this.resetFlow.submit(
            (error, fallback) => this.getAuthErrorMessage(error, fallback),
            (password) => this.isRegisterPasswordValid(password),
        );

        if (this.resetFlow.message) {
            setTimeout(() => this.closeResetPasswordOverlay(), 2000);
        }
    }

    /** Handles toggle password visibility. */
    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    /** Handles toggle new password visibility. */
    toggleNewPasswordVisibility(): void {
        this.resetFlow.toggleNewPasswordVisibility();
    }

    /** Handles toggle confirm password visibility. */
    toggleConfirmPasswordVisibility(): void {
        this.resetFlow.toggleConfirmPasswordVisibility();
    }

    /** Shows login feedback popup. */
    showLoginFeedback(
        message: string,
        type: 'loading' | 'success' | 'error' = 'loading',
    ): void {
        this.clearLoginFeedbackTimeout();

        this.ngZone.run(() => {
            this.loginFeedbackMessage = message;
            this.loginFeedbackType = type;
            this.loginFeedbackVisible = true;
            this.cdr.detectChanges();
        });
    }

    /** Hides login feedback popup, optionally delayed. */
    hideLoginFeedback(delay = 0): void {
        this.clearLoginFeedbackTimeout();

        if (delay <= 0) {
            this.ngZone.run(() => {
                this.loginFeedbackVisible = false;
                this.cdr.detectChanges();
            });
            return;
        }

        this.loginFeedbackTimeout = setTimeout(() => {
            this.ngZone.run(() => {
                this.loginFeedbackVisible = false;
                this.loginFeedbackTimeout = null;
                this.cdr.detectChanges();
            });
        }, delay);
    }

    /** Clears pending feedback timeout. */
    private clearLoginFeedbackTimeout(): void {
        if (this.loginFeedbackTimeout) {
            clearTimeout(this.loginFeedbackTimeout);
            this.loginFeedbackTimeout = null;
        }
    }

    /** Returns email control. */
    get emailControl() {
        return this.loginForm.controls.email;
    }

    /** Returns password control. */
    get passwordControl() {
        return this.loginForm.controls.password;
    }

    /** Returns display name control. */
    get displayNameControl() {
        return this.loginForm.controls.displayName;
    }

    /** Returns forgot password email control. */
    get forgotPasswordEmailControl() {
        return this.forgotPasswordForm.controls.email;
    }

    /** Returns show reset password overlay. */
    get showResetPasswordOverlay(): boolean {
        return this.resetFlow.showOverlay;
    }

    /** Returns reset password form. */
    get resetPasswordForm() {
        return this.resetFlow.form;
    }

    /** Returns show reset password error. */
    get showResetPasswordError(): boolean {
        return this.resetFlow.hasUiError((p) => this.isRegisterPasswordValid(p));
    }

    /** Returns reset password error message. */
    get resetPasswordErrorMessage(): string {
        return this.resetFlow.buildUiErrorMessage((p) => this.isRegisterPasswordValid(p));
    }

    /** Returns reset password message. */
    get resetPasswordMessage(): string {
        return this.resetFlow.message;
    }

    /** Returns reset password error. */
    get resetPasswordError(): string {
        return this.resetFlow.error;
    }

    /** Returns show new password. */
    get showNewPassword(): boolean {
        return this.resetFlow.showNewPassword;
    }

    /** Returns show confirm password. */
    get showConfirmPassword(): boolean {
        return this.resetFlow.showConfirmPassword;
    }

    /** Returns password checks. */
    get passwordChecks() {
        const value = this.passwordControl.value ?? '';

        return {
            minLength: value.length >= 8,
            uppercase: /[A-ZÄÖÜ]/.test(value),
            specialChar: /[^A-Za-z0-9]/.test(value),
        };
    }

    /** Returns password error message. */
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

    /** Returns primary submit disabled state. */
    get isPrimarySubmitDisabled(): boolean {
        if (this.isSubmitting) return true;

        if (!this.isRegisterMode) {
            return this.emailControl.invalid || this.passwordControl.invalid;
        }

        const displayName = (this.displayNameControl.value ?? '').trim();
        const password = this.passwordControl.value ?? '';

        return !displayName || this.emailControl.invalid || !this.isRegisterPasswordValid(password);
    }

    /** Returns show password error. */
    get showPasswordError(): boolean {
        const password = this.passwordControl.value ?? '';

        return this.passwordControl.touched &&
            !!password.trim() &&
            (
                this.passwordControl.invalid ||
                (this.isRegisterMode && !this.isRegisterPasswordValid(password))
            );
    }

    /** Handles can submit register. */
    private canSubmitRegister(
        mode: 'login' | 'register',
        displayName: string,
        password: string,
    ): boolean {
        if (mode !== 'register') return true;

        if (!this.isRegisterPasswordValid(password)) {
            return this.rejectRegisterPassword();
        }

        if (!!displayName) return true;

        this.errorMessage = 'Bitte gib einen Anzeigenamen ein.';
        this.displayNameControl.markAsTouched();
        return false;
    }

    /** Handles reject register password. */
    private rejectRegisterPassword(): boolean {
        this.errorMessage =
            'Das Passwort erfüllt nicht die Anforderungen für die Registrierung.';
        return false;
    }

    /** Handles run submit. */
    private async runSubmit(
        mode: 'login' | 'register',
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        this.startSubmitting();

        if (mode === 'login') {
            this.showLoginFeedback('Anmeldung', 'loading');
        }

        try {
            await this.authenticate(mode, displayName, email, password);

            if (mode === 'login') {
                this.showLoginFeedback('Erfolgreich angemeldet', 'success');
                this.hideLoginFeedback(1600);
            }
        } catch (error) {
            this.errorMessage = this.resolveSubmitError(mode, error);

            if (mode === 'login') {
                this.showLoginFeedback('Anmeldung fehlgeschlagen', 'error');
                this.hideLoginFeedback(2200);
            }
        } finally {
            this.isSubmitting = false;
        }
    }

    /** Handles run google login. */
    private async runGoogleLogin(): Promise<void> {
        const result = await this.authService.loginWithGoogle();
        this.successMessage = 'Erfolgreich mit Google angemeldet.';
        await this.authFlow.syncEmailFromAuth(result.email ?? '');
        await this.authFlow.navigateAfterLogin();
    }

    /** Handles resolve google error. */
    private resolveGoogleError(error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            'Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
        );
    }

    /** Handles run guest login. */
    private async runGuestLogin(): Promise<void> {
        await this.authService.loginAsGuest();
        this.successMessage = 'Erfolgreich als Gast angemeldet.';
        void this.router.navigateByUrl('/app');
    }

    /** Handles resolve guest error. */
    private resolveGuestError(error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            'Gast-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
        );
    }

    /** Handles prepare reset email submit. */
    private prepareResetEmailSubmit(): string {
        this.isSubmitting = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
        return (this.forgotPasswordForm.value.email ?? '').trim();
    }

    /** Handles run send reset email. */
    private async runSendResetEmail(email: string): Promise<void> {
        await this.authService.sendPasswordResetEmail(email);
        this.forgotPasswordMessage =
            'Wenn für diese E-Mail ein Konto mit Passwort-Anmeldung existiert, wurde eine Reset-E-Mail versendet. Bitte überprüfe dein Postfach (auch Spam-Ordner).';
        setTimeout(() => this.closeForgotPasswordOverlay(), 3000);
    }

    /** Handles resolve send reset error. */
    private resolveSendResetError(error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            'Fehler beim Senden der E-Mail. Bitte versuche es erneut.',
        );
    }

    /** Handles update auth screen visibility. */
    private updateAuthScreenVisibility(url: string): void {
        const pathname = (url || '').split('?')[0];
        this.showAuthScreen = pathname === '/' || pathname === '';
    }

    /** Handles handle reset link from url. */
    private handleResetLinkFromUrl(url: string): void {
        const params = new URLSearchParams((url.split('?')[1] ?? '').trim());
        const mode = params.get('mode') ?? '';
        const code = params.get('oobCode') ?? '';

        if (mode === 'resetPassword' && code) {
            this.openResetPasswordOverlay(code);
        }
    }

    /** Handles ensure valid login form. */
    private ensureValidLoginForm(): boolean {
        if (!this.loginForm.invalid) return true;
        this.loginForm.markAllAsTouched();
        return false;
    }

    /** Handles ensure valid reset form. */
    private ensureValidResetForm(): boolean {
        if (!this.forgotPasswordForm.invalid) return true;
        this.forgotPasswordForm.markAllAsTouched();
        return false;
    }

    /** Handles start submitting. */
    private startSubmitting(): void {
        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    /** Handles read login credentials. */
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

    /** Handles is register password valid. */
    private isRegisterPasswordValid(password: string): boolean {
        return (
            password.length >= 8 &&
            /[A-ZÄÖÜ]/.test(password) &&
            /[^A-Za-z0-9]/.test(password)
        );
    }

    /** Handles authenticate. */
    private async authenticate(
        mode: 'login' | 'register',
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        if (mode === 'login') {
            await this.authService.loginWithEmailAndPassword(email, password);
            this.successMessage = 'Angemeldet.';
        } else {
            await this.authService.registerWithEmailAndPassword(email, password);
            await this.userService.updateCurrentUserProfile({ displayName, email });
            this.successMessage = 'Konto erfolgreich erstellt.';
        }

        await this.authFlow.syncEmailFromAuth(email);
        await this.authFlow.navigateAfterLogin();
    }

    /** Handles resolve submit error. */
    private resolveSubmitError(mode: 'login' | 'register', error: unknown): string {
        return this.getAuthErrorMessage(
            error,
            mode === 'login'
                ? 'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.'
                : 'Registrierung fehlgeschlagen. Bitte versuche es erneut.',
        );
    }

    /** Handles get auth error message. */
    private getAuthErrorMessage(error: unknown, fallback: string): string {
        const { code, message } = parseFirebaseError(error);

        if (!code) {
            return message ? `${fallback} (${message})` : fallback;
        }

        const mapped = AUTH_ERROR_MESSAGES[code];
        if (mapped) return mapped;

        return formatFallbackError(fallback, code, message);
    }
}
