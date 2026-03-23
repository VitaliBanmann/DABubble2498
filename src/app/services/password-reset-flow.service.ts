import { Injectable } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PasswordResetFlowService {
    showOverlay = false;
    showNewPassword = false;
    showConfirmPassword = false;
    isSubmitting = false;
    resetCode = '';
    message = '';
    error = '';

    form = this.formBuilder.group({
        newPassword: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]],
    });

    constructor(
        private readonly formBuilder: FormBuilder,
        private readonly authService: AuthService,
    ) {}

    open(code: string): void {
        this.showOverlay = true;
        this.resetCode = code;
        this.message = '';
        this.error = '';
        this.showNewPassword = false;
        this.showConfirmPassword = false;
    }

    close(): void {
        this.showOverlay = false;
        this.form.reset();
        this.message = '';
        this.error = '';
        this.resetCode = '';
    }

    toggleNewPasswordVisibility(): void {
        this.showNewPassword = !this.showNewPassword;
    }

    toggleConfirmPasswordVisibility(): void {
        this.showConfirmPassword = !this.showConfirmPassword;
    }

    get passwordControl() {
        return this.form.controls.newPassword;
    }

    get confirmPasswordControl() {
        return this.form.controls.confirmPassword;
    }

    hasUiError(isRegisterPasswordValid: (password: string) => boolean): boolean {
        const newPassword = this.passwordControl.value ?? '';
        const confirmPassword = this.confirmPasswordControl.value ?? '';
        const touched = this.passwordControl.touched || this.confirmPasswordControl.touched;
        return touched && (
            this.passwordControl.invalid ||
            this.confirmPasswordControl.invalid ||
            (!!newPassword && !!confirmPassword && newPassword !== confirmPassword) ||
            !isRegisterPasswordValid(newPassword)
        );
    }

    buildUiErrorMessage(isRegisterPasswordValid: (password: string) => boolean): string {
        const newPassword = this.passwordControl.value ?? '';
        const confirmPassword = this.confirmPasswordControl.value ?? '';
        if (!newPassword || !confirmPassword) return 'Bitte fülle beide Passwortfelder aus.';
        if (!isRegisterPasswordValid(newPassword)) {
            return 'Das Passwort muss mindestens 8 Zeichen, 1 Großbuchstaben und 1 Sonderzeichen enthalten.';
        }
        if (newPassword !== confirmPassword) return 'Die Passwörter stimmen nicht überein.';
        return '';
    }

    async submit(
        getAuthErrorMessage: (error: unknown, fallback: string) => string,
        isRegisterPasswordValid: (password: string) => boolean,
    ): Promise<void> {
        if (!this.canSubmit(isRegisterPasswordValid)) return;
        const newPassword = this.prepareSubmit();
        try {
            await this.submitConfirmReset(newPassword);
        } catch (error) {
            this.error = this.resolveSubmitError(error, getAuthErrorMessage);
        } finally {
            this.isSubmitting = false;
        }
    }

    private prepareSubmit(): string {
        this.isSubmitting = true;
        this.message = '';
        this.error = '';
        return this.passwordControl.value ?? '';
    }

    private async submitConfirmReset(newPassword: string): Promise<void> {
        await this.authService.confirmPasswordReset(this.resetCode, newPassword);
        this.message = 'Passwort erfolgreich aktualisiert. Du kannst dich jetzt anmelden.';
    }

    private resolveSubmitError(
        error: unknown,
        getAuthErrorMessage: (error: unknown, fallback: string) => string,
    ): string {
        return getAuthErrorMessage(
            error,
            'Passwort konnte nicht zurückgesetzt werden. Bitte fordere einen neuen Link an.',
        );
    }

    private canSubmit(isRegisterPasswordValid: (password: string) => boolean): boolean {
        if (!this.hasResetCode()) return false;
        if (!this.isFormReady()) return false;
        const newPassword = this.passwordControl.value ?? '';
        const confirmPassword = this.confirmPasswordControl.value ?? '';
        if (!isRegisterPasswordValid(newPassword)) return false;
        if (newPassword === confirmPassword) return true;
        this.confirmPasswordControl.markAsTouched();
        return false;
    }

    private hasResetCode(): boolean {
        if (!!this.resetCode) return true;
        this.error = 'Der Reset-Link ist ungültig. Bitte fordere einen neuen Link an.';
        return false;
    }

    private isFormReady(): boolean {
        if (!this.form.invalid) return true;
        this.form.markAllAsTouched();
        return false;
    }
}
