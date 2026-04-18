import { ChangeDetectorRef, NgZone } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthFlowService } from './services/auth-flow.service';
import { AuthService } from './services/auth.service';
import { PasswordResetFlowService } from './services/password-reset-flow.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';

const STRICT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export abstract class AppAuthStateBase {
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
    registerSubmitAttempted = false;

    loginFeedbackVisible = false;
    loginFeedbackMessage = '';
    loginFeedbackType: 'loading' | 'success' | 'error' = 'loading';

    private loginFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

    readonly loginForm = this.formBuilder.group({
        displayName: ['', [Validators.maxLength(30)]],
        email: [
            '',
            [Validators.required, Validators.email, Validators.pattern(STRICT_EMAIL_PATTERN)],
        ],
        password: ['', [Validators.required, Validators.minLength(6)]],
        rememberMe: [false],
    });

    readonly forgotPasswordForm = this.formBuilder.group({
        email: [
            '',
            [Validators.required, Validators.email, Validators.pattern(STRICT_EMAIL_PATTERN)],
        ],
    });

    protected constructor(
        protected readonly formBuilder: FormBuilder,
        protected readonly authFlow: AuthFlowService,
        protected readonly authService: AuthService,
        protected readonly userService: UserService,
        readonly resetFlow: PasswordResetFlowService,
        protected readonly presenceService: PresenceService,
        protected readonly router: Router,
        protected readonly cdr: ChangeDetectorRef,
        protected readonly ngZone: NgZone,
    ) {}

    enterRegisterMode(): void {
        this.isRegisterMode = true;
        this.resetAuthFormState();
    }

    enterLoginMode(): void {
        this.isRegisterMode = false;
        this.resetAuthFormState();
    }

    onPasswordEnter(event: Event): void {
        if (this.isRegisterMode || this.isSubmitting) return;
        event.preventDefault();
        void this.onSubmit('login');
    }

    openForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
        const loginEmail = this.loginForm.value.email?.trim() ?? '';
        this.forgotPasswordForm.patchValue({ email: loginEmail });
    }

    closeForgotPasswordOverlay(): void {
        this.showForgotPasswordOverlay = false;
        this.forgotPasswordForm.reset();
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
    }

    openResetPasswordOverlay(code: string): void {
        this.showForgotPasswordOverlay = false;
        this.resetFlow.open(code);
    }

    closeResetPasswordOverlay(): void {
        this.resetFlow.close();
        void this.router.navigate([], {
            queryParams: { mode: null, oobCode: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    togglePasswordVisibility(): void { this.showPassword = !this.showPassword; }

    toggleNewPasswordVisibility(): void { this.resetFlow.toggleNewPasswordVisibility(); }

    toggleConfirmPasswordVisibility(): void { this.resetFlow.toggleConfirmPasswordVisibility(); }

    showLoginFeedback(message: string, type: 'loading' | 'success' | 'error' = 'loading'): void {
        this.clearLoginFeedbackTimeout();
        this.ngZone.run(() => {
            this.loginFeedbackMessage = message;
            this.loginFeedbackType = type;
            this.loginFeedbackVisible = true;
            this.cdr.detectChanges();
        });
    }

    hideLoginFeedback(delay = 0): void {
        this.clearLoginFeedbackTimeout();
        if (delay <= 0) return this.hideFeedbackImmediately();
        this.scheduleDelayedFeedbackHide(delay);
    }

    get emailControl() { return this.loginForm.controls.email; }
    get passwordControl() { return this.loginForm.controls.password; }
    get displayNameControl() { return this.loginForm.controls.displayName; }
    get forgotPasswordEmailControl() { return this.forgotPasswordForm.controls.email; }
    get showResetPasswordOverlay(): boolean { return this.resetFlow.showOverlay; }
    get resetPasswordForm() { return this.resetFlow.form; }
    get showNewPassword(): boolean { return this.resetFlow.showNewPassword; }
    get showConfirmPassword(): boolean { return this.resetFlow.showConfirmPassword; }
    get resetPasswordMessage(): string { return this.resetFlow.message; }
    get resetPasswordError(): string { return this.resetFlow.error; }

    get showResetPasswordError(): boolean {
        return this.resetFlow.hasUiError((password) => this.isRegisterPasswordValid(password));
    }

    get resetPasswordErrorMessage(): string {
        return this.resetFlow.buildUiErrorMessage((password) => this.isRegisterPasswordValid(password));
    }

    get passwordChecks() {
        const value = this.passwordControl.value ?? '';
        return {
            minLength: value.length >= 8,
            uppercase: /[A-ZÄÖÜ]/.test(value),
            lowercase: /[a-zäöü]/.test(value),
            specialChar: /[^A-Za-z0-9]/.test(value),
        };
    }

    get passwordErrorMessage(): string {
        const password = this.passwordControl.value ?? '';
        if (!password) return this.isRegisterMode ? 'Bitte gib ein Passwort ein.' : 'Bitte gib dein Passwort ein.';
        if (this.isRegisterMode && !this.isRegisterPasswordValid(password)) {
            return 'Das Passwort muss mindestens 8 Zeichen, 1 Großbuchstaben, 1 Kleinbuchstaben und 1 Sonderzeichen enthalten.';
        }
        if (password.length < 6) return 'Das Passwort muss mindestens 6 Zeichen lang sein.';
        return '';
    }

    get isPrimarySubmitDisabled(): boolean {
        if (this.isSubmitting) return true;
        if (!this.isRegisterMode) return this.emailControl.invalid || this.passwordControl.invalid;
        return false;
    }

    get showPasswordError(): boolean {
        const password = this.passwordControl.value ?? '';
        if (this.isRegisterMode) {
            return this.registerSubmitAttempted
                && !!password.trim()
                && !this.isRegisterPasswordValid(password);
        }

        return this.passwordControl.touched
            && !!password.trim()
            && this.passwordControl.invalid;
    }

    protected updateAuthScreenVisibility(url: string): void {
        const pathname = (url || '').split('?')[0];
        this.showAuthScreen = pathname === '/' || pathname === '';
    }

    protected handleResetLinkFromUrl(url: string): void {
        const params = new URLSearchParams((url.split('?')[1] ?? '').trim());
        const mode = params.get('mode') ?? '';
        const code = params.get('oobCode') ?? '';
        if (mode === 'resetPassword' && code) this.openResetPasswordOverlay(code);
    }

    protected startSubmitting(): void {
        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';
    }

    protected ensureValidLoginForm(): boolean {
        if (!this.loginForm.invalid) return true;
        this.loginForm.markAllAsTouched();
        return false;
    }

    protected ensureValidResetForm(): boolean {
        if (!this.forgotPasswordForm.invalid) return true;
        this.forgotPasswordForm.markAllAsTouched();
        return false;
    }

    protected readLoginCredentials(): { displayName: string; email: string; password: string } {
        return {
            displayName: (this.loginForm.value.displayName ?? '').trim(),
            email: (this.loginForm.value.email ?? '').trim(),
            password: this.loginForm.value.password ?? '',
        };
    }

    protected isRegisterPasswordValid(password: string): boolean {
        return password.length >= 8
            && /[A-ZÄÖÜ]/.test(password)
            && /[a-zäöü]/.test(password)
            && /[^A-Za-z0-9]/.test(password);
    }

    protected prepareResetEmailSubmit(): string {
        this.isSubmitting = true;
        this.forgotPasswordMessage = '';
        this.forgotPasswordError = '';
        return (this.forgotPasswordForm.value.email ?? '').trim();
    }

    private clearLoginFeedbackTimeout(): void {
        if (!this.loginFeedbackTimeout) return;
        clearTimeout(this.loginFeedbackTimeout);
        this.loginFeedbackTimeout = null;
    }

    private resetAuthFormState(): void {
        this.loginForm.reset({
            displayName: '',
            email: '',
            password: '',
            rememberMe: false,
        });

        this.errorMessage = '';
        this.successMessage = '';
        this.isSubmitting = false;
        this.registerSubmitAttempted = false;

        this.showPassword = false;

        this.loginFeedbackVisible = false;
        this.loginFeedbackMessage = '';
        this.loginFeedbackType = 'loading';
        this.clearLoginFeedbackTimeout();
    }

    private hideFeedbackImmediately(): void {
        this.ngZone.run(() => {
            this.loginFeedbackVisible = false;
            this.cdr.detectChanges();
        });
    }

    private scheduleDelayedFeedbackHide(delay: number): void {
        this.loginFeedbackTimeout = setTimeout(() => {
            this.ngZone.run(() => {
                this.loginFeedbackVisible = false;
                this.loginFeedbackTimeout = null;
                this.cdr.detectChanges();
            });
        }, delay);
    }

    abstract onSubmit(mode: 'login' | 'register'): Promise<void>;
}
