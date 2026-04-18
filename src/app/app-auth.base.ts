import {
    AUTH_ERROR_MESSAGES,
    formatFallbackError,
    parseFirebaseError,
} from './app-auth.util';
import { AppAuthStateBase } from './app-auth-state.base';

export abstract class AppAuthBase extends AppAuthStateBase {
    async onSubmit(mode: 'login' | 'register'): Promise<void> {
        this.clearEmailAlreadyInUseError();
        this.isRegisterMode = mode === 'register';
        this.registerSubmitAttempted = this.isRegisterMode;
        if (!this.ensureValidLoginForm()) return;

        const { displayName, email, password } = this.readLoginCredentials();
        if (!this.canSubmitRegister(mode, displayName, password)) return;

        await this.runSubmit(mode, displayName, email, password);
    }

    async onGoogleLogin(): Promise<void> {
        this.startSubmitting();

        try {
            await this.runGoogleLogin();
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
        this.startSubmitting();

        try {
            await this.runGuestLogin();
        } catch (error) {
            this.errorMessage = this.getAuthErrorMessage(
                error,
                'Gast-Anmeldung fehlgeschlagen. Bitte versuche es erneut.',
            );
        } finally {
            this.isSubmitting = false;
        }
    }

    async sendPasswordResetEmail(): Promise<void> {
        if (!this.ensureValidResetForm()) return;
        const email = this.prepareResetEmailSubmit();

        try {
            await this.sendResetEmailAndApplySuccess(email);
        } catch (error) {
            this.applyResetEmailError(error);
        } finally {
            this.isSubmitting = false;
        }
    }

    async confirmPasswordResetFromLink(): Promise<void> {
        await this.resetFlow.submit(
            (error, fallback) => this.getAuthErrorMessage(error, fallback),
            (password) => this.isRegisterPasswordValid(password),
        );

        if (this.resetFlow.message) {
            setTimeout(() => this.closeResetPasswordOverlay(), 2000);
        }
    }

    private canSubmitRegister(
        mode: 'login' | 'register',
        displayName: string,
        password: string,
    ): boolean {
        if (mode !== 'register') return true;

        if (!this.isRegisterPasswordValid(password)) {
            this.errorMessage = 'Das Passwort erfüllt nicht die Anforderungen für die Registrierung.';
            return false;
        }

        if (!!displayName) return true;

        this.errorMessage = 'Bitte gib einen Anzeigenamen ein.';
        this.displayNameControl.markAsTouched();
        return false;
    }

    private async runSubmit(
        mode: 'login' | 'register',
        displayName: string,
        email: string,
        password: string,
    ): Promise<void> {
        this.startSubmitting();
        this.showLoginLoadingFeedback(mode);

        try {
            await this.authenticate(mode, displayName, email, password);
            this.showLoginSuccessFeedback(mode);
        } catch (error) {
            this.applySubmitError(mode, error);
            this.showLoginFailureFeedback(mode);
        } finally {
            this.isSubmitting = false;
        }
    }

    private async sendResetEmailAndApplySuccess(email: string): Promise<void> {
        await this.authService.sendPasswordResetEmail(email);
        this.forgotPasswordMessage =
            'Wenn für diese E-Mail ein Konto mit Passwort-Anmeldung existiert, wurde eine Reset-E-Mail versendet. Bitte überprüfe dein Postfach (auch Spam-Ordner).';
        setTimeout(() => this.closeForgotPasswordOverlay(), 3000);
    }

    private applyResetEmailError(error: unknown): void {
        this.forgotPasswordError = this.getAuthErrorMessage(
            error,
            'Fehler beim Senden der E-Mail. Bitte versuche es erneut.',
        );
    }

    private showLoginLoadingFeedback(mode: 'login' | 'register'): void {
        setTimeout(() => {
            if (mode === 'login') {
                this.showLoginFeedback('Anmeldung läuft', 'loading');
                return;
            }

            this.showLoginFeedback('Konto wird erstellt', 'loading');
        });
    }

    private showLoginSuccessFeedback(mode: 'login' | 'register'): void {
        setTimeout(() => {
            if (mode === 'login') {
                this.showLoginFeedback('Erfolgreich angemeldet', 'success');
                this.hideLoginFeedback(1600);
                return;
            }

            this.showLoginFeedback('Konto erfolgreich erstellt', 'success');
            this.hideLoginFeedback(1800);
        });
    }

    private showLoginFailureFeedback(mode: 'login' | 'register'): void {
        setTimeout(() => {
            if (mode === 'login') {
                this.showLoginFeedback('Anmeldung fehlgeschlagen', 'error');
                this.hideLoginFeedback(2200);
                return;
            }

            this.showLoginFeedback('Konto konnte nicht erstellt werden', 'error');
            this.hideLoginFeedback(2200);
        });
    }

    private applySubmitError(mode: 'login' | 'register', error: unknown): void {
        const { code } = parseFirebaseError(error);

        if (mode === 'register' && code === 'auth/email-already-in-use') {
            this.applyEmailAlreadyInUseError();
        }

        const fallback = mode === 'login'
            ? 'Anmeldung fehlgeschlagen. Bitte überprüfe E-Mail und Passwort.'
            : 'Registrierung fehlgeschlagen. Bitte versuche es erneut.';
        this.errorMessage =
            mode === 'register' && code === 'auth/email-already-in-use'
                ? ''
                : this.getAuthErrorMessage(error, fallback);
    }

    private applyEmailAlreadyInUseError(): void {
        const currentErrors = this.emailControl.errors ?? {};

        this.emailControl.setErrors({
            ...currentErrors,
            emailAlreadyInUse: true,
        });

        this.emailControl.markAsTouched();
    }

    private clearEmailAlreadyInUseError(): void {
        const currentErrors = { ...(this.emailControl.errors ?? {}) };

        if (!currentErrors['emailAlreadyInUse']) {
            return;
        }

        delete currentErrors['emailAlreadyInUse'];

        this.emailControl.setErrors(
            Object.keys(currentErrors).length ? currentErrors : null,
        );
    }

    private async runGoogleLogin(): Promise<void> {
        const result = await this.authService.loginWithGoogle();
        this.successMessage = 'Erfolgreich mit Google angemeldet.';
        await this.authFlow.syncEmailFromAuth(result.email ?? '');
        await this.authFlow.navigateAfterLogin();
    }

    private async runGuestLogin(): Promise<void> {
        await this.authService.loginAsGuest();
        this.successMessage = 'Erfolgreich als Gast angemeldet.';
        void this.router.navigateByUrl('/app');
    }

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
