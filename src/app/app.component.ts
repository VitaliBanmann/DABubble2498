import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
    NavigationEnd,
    Router,
    RouterLink,
    RouterOutlet,
} from '@angular/router';
import { AuthService } from './services/auth.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';
import { take } from 'rxjs';

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
        password: ['', [Validators.required]],
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
        @Inject(PresenceService)
        private readonly presenceService: PresenceService,
        private readonly userService: UserService,
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
            if (!user) {
                this.showAuthScreen = true;

                const pathname = (this.router.url || '').split('?')[0];
                const isProtectedArea =
                    pathname.startsWith('/app') ||
                    pathname.startsWith('/home') ||
                    pathname.startsWith('/avatar-select');

                if (isProtectedArea) {
                    void this.router.navigateByUrl('/');
                }

                return;
            }

            // Wenn User eingeloggt und noch auf "/" ist -> intelligente Navigation
            const pathname = (this.router.url || '').split('?')[0];
            if (pathname === '/' || pathname === '') {
                // Prüfe ob User bereits ein Profil mit Avatar hat
                this.userService
                    .getUser(user.uid)
                    .pipe(take(1))
                    .subscribe({
                        next: (profile) => {
                            if (profile && profile.avatar) {
                                void this.router.navigateByUrl('/home');
                            } else {
                                void this.router.navigateByUrl('/avatar-select');
                            }
                        },
                        error: () => {
                            void this.router.navigateByUrl('/avatar-select');
                        },
                    });
            }
        });
    }

    private updateAuthScreenVisibility(url: string): void {
        const pathname = (url || '').split('?')[0];

        // Auth-Screen NUR auf "/"
        this.showAuthScreen = pathname === '/' || pathname === '';
    }

    async onSubmit(mode: 'login' | 'register'): Promise<void> {
        // Setze Register-Modus
        this.isRegisterMode = (mode === 'register');
        
        if (this.loginForm.invalid) {
            this.loginForm.markAllAsTouched();
            return;
        }

        this.isSubmitting = true;
        this.errorMessage = '';
        this.successMessage = '';

        const email = (this.loginForm.value.email ?? '').trim();
        const password = this.loginForm.value.password ?? '';

        if (mode === 'register' && !this.isPasswordStrong) {
            this.errorMessage =
                'Für die Registrierung muss das Kennwort mindestens 8 Zeichen, einen Großbuchstaben und ein Sonderzeichen enthalten.';
            this.isSubmitting = false;
            return;
        }

        try {
            if (mode === 'login') {
                await this.authService.loginWithEmailAndPassword(
                    email,
                    password,
                );
                this.successMessage = 'Angemeldet.';

                // Prüfe ob User bereits ein Profil hat
                const currentUser = this.authService.getCurrentUser();
                if (currentUser) {
                    this.userService
                        .getUser(currentUser.uid)
                        .pipe(take(1))
                        .subscribe({
                            next: (profile) => {
                                // Falls Profil existiert und Avatar vorhanden → direkt zu Home
                                if (profile && profile.avatar) {
                                    void this.router.navigateByUrl('/home');
                                } else {
                                    // Sonst → Avatar auswählen
                                    void this.router.navigateByUrl('/avatar-select');
                                }
                            },
                            error: () => {
                                // Bei Fehler → Avatar auswählen lassen
                                void this.router.navigateByUrl('/avatar-select');
                            },
                        });
                } else {
                    void this.router.navigateByUrl('/avatar-select');
                }
            } else {
                await this.authService.registerWithEmailAndPassword(
                    email,
                    password,
                );
                this.successMessage = 'Konto erfolgreich erstellt.';
                // Bei Registrierung → immer Avatar auswählen
                void this.router.navigateByUrl('/avatar-select');
            }
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

    get passwordChecks() {
        const value = this.passwordControl.value ?? '';
        return {
            minLength: value.length >= 8,
            uppercase: /[A-ZÄÖÜ]/.test(value),
            specialChar: /[^A-Za-z0-9]/.test(value),
        };
    }

    get isPasswordStrong(): boolean {
        const checks = this.passwordChecks;
        return checks.minLength && checks.uppercase && checks.specialChar;
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
            
            // Prüfe ob User bereits ein Profil hat
            const currentUser = this.authService.getCurrentUser();
            if (!currentUser) {
                void this.router.navigateByUrl('/avatar-select');
                return;
            }

            // Lade Profil aus Firestore
            this.userService
                .getUser(currentUser.uid)
                .pipe(take(1))
                .subscribe({
                    next: (profile) => {
                        // Falls Profil existiert und Avatar vorhanden → direkt zu Home
                        if (profile && profile.avatar) {
                            void this.router.navigateByUrl('/home');
                        } else {
                            // Sonst → Avatar auswählen
                            void this.router.navigateByUrl('/avatar-select');
                        }
                    },
                    error: () => {
                        // Bei Fehler → Avatar auswählen lassen
                        void this.router.navigateByUrl('/avatar-select');
                    },
                });
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
                return 'Google-Fenster wurde geschlossen. Bitte klicke erneut auf „Anmelden mit Google“ und schließe das Fenster nicht, bis die Anmeldung abgeschlossen ist.';
            case 'auth/popup-blocked':
                return 'Popup wurde blockiert. Bitte erlaube Popups für diese Seite und klicke danach erneut auf „Anmelden mit Google“.';
            case 'auth/unauthorized-domain':
                return 'Diese Domain ist in Firebase noch nicht freigegeben. Bitte melde dich beim Support/Team und versuche es danach erneut.';
            case 'auth/operation-not-allowed':
                return 'Google-Anmeldung ist aktuell nicht aktiviert. Bitte melde dich beim Support/Team.';
            case 'auth/admin-restricted-operation':
                return 'Diese Anmeldung ist derzeit eingeschränkt. Bitte melde dich beim Support/Team.';
            case 'auth/invalid-email':
                return 'Ungültige E-Mail-Adresse. Bitte überprüfe deine Eingabe.';
            case 'auth/invalid-credential':
                return 'E-Mail oder Passwort ist nicht korrekt. Bitte prüfe beides und versuche es erneut.';
            case 'auth/weak-password':
                return 'Das Kennwort ist zu schwach. Verwende mindestens 8 Zeichen, einen Großbuchstaben und ein Sonderzeichen.';
            case 'auth/wrong-password':
                return 'Falsches Passwort. Bitte versuche es erneut.';
            case 'auth/user-not-found':
                return 'Kein Konto mit dieser E-Mail gefunden.';
            case 'auth/email-already-in-use':
                return 'Diese E-Mail ist bereits registriert.';
            case 'auth/network-request-failed':
                return 'Netzwerkfehler. Bitte Internetverbindung prüfen und dann erneut versuchen.';
            default:
                return message
                    ? `${fallback} (${code}: ${message})`
                    : `${fallback} (${code})`;
        }
    }
}
