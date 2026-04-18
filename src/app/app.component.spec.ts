import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthFlowService } from './services/auth-flow.service';
import { AuthService } from './services/auth.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';

class MockAuthService {
    authReady$ = of(true);
    currentUser$ = of(null);

    registerWithEmailAndPassword(): Promise<void> {
        return Promise.resolve();
    }

    loginWithEmailAndPassword(): Promise<void> {
        return Promise.resolve();
    }

    loginWithGoogle(): Promise<void> {
        return Promise.resolve();
    }

    sendPasswordResetEmail(): Promise<void> {
        return Promise.resolve();
    }

    confirmPasswordReset(): Promise<void> {
        return Promise.resolve();
    }

    getCurrentUser() {
        return null;
    }
}

class MockPresenceService {
    startTracking(): void {}
}

class MockAuthFlowService {
    handleAuthState(): Promise<void> {
        return Promise.resolve();
    }

    syncEmailFromAuth(): Promise<void> {
        return Promise.resolve();
    }

    navigateAfterLogin(): Promise<void> {
        return Promise.resolve();
    }

    logoutToLogin(): Promise<void> {
        return Promise.resolve();
    }
}

class MockUserService {
    getUser() {
        return of(null);
    }
}

describe('AppComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AppComponent],
            providers: [
                provideRouter([]),
                { provide: AuthFlowService, useClass: MockAuthFlowService },
                { provide: AuthService, useClass: MockAuthService },
                { provide: PresenceService, useClass: MockPresenceService },
                { provide: UserService, useClass: MockUserService },
            ],
        }).compileComponents();
    });

    it('should create the app', () => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        expect(app).toBeTruthy();
    });

    it('should render login title', () => {
        const fixture = TestBed.createComponent(AppComponent);
        fixture.detectChanges();
        const compiled = fixture.nativeElement as HTMLElement;
        expect(compiled.querySelector('h1')?.textContent).toContain(
            'Anmeldung',
        );
        expect(compiled.querySelector('input[type="email"]')).not.toBeNull();
        expect(compiled.querySelector('input[type="password"]')).not.toBeNull();
    });

    it('should prefill reset email when opening forgot-password overlay', () => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        app.loginForm.patchValue({ email: ' test@example.com ' });

        app.openForgotPasswordOverlay();

        expect(app.showForgotPasswordOverlay).toBeTrue();
        expect(app.forgotPasswordForm.value.email).toBe('test@example.com');
    });

    it('should not send reset email when reset form is invalid', async () => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        const auth = TestBed.inject(AuthService);
        const resetSpy = spyOn(auth, 'sendPasswordResetEmail').and.resolveTo();
        app.forgotPasswordForm.patchValue({ email: 'invalid-email' });

        await app.sendPasswordResetEmail();

        expect(resetSpy).not.toHaveBeenCalled();
        expect(app.forgotPasswordEmailControl.touched).toBeTrue();
    });

    it('should send reset email and close overlay after success timeout', fakeAsync(() => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        const auth = TestBed.inject(AuthService);
        const resetSpy = spyOn(auth, 'sendPasswordResetEmail').and.resolveTo();
        app.openForgotPasswordOverlay();
        app.forgotPasswordForm.patchValue({ email: 'user@example.com' });

        void app.sendPasswordResetEmail();
        tick();

        expect(resetSpy).toHaveBeenCalledWith('user@example.com');
        expect(app.forgotPasswordMessage).toContain('E-Mail gesendet');

        tick(3000);
        expect(app.showForgotPasswordOverlay).toBeFalse();
    }));

    it('should confirm password reset when form is valid', fakeAsync(() => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        const auth = TestBed.inject(AuthService);
        const confirmSpy = spyOn(auth, 'confirmPasswordReset').and.resolveTo();
        app.openResetPasswordOverlay('abc-code');
        app.resetPasswordForm.patchValue({
            newPassword: 'Strong!Pass1',
            confirmPassword: 'Strong!Pass1',
        });

        void app.confirmPasswordResetFromLink();
        tick();

        expect(confirmSpy).toHaveBeenCalledWith('abc-code', 'Strong!Pass1');
        expect(app.resetPasswordMessage).toContain('Passwort erfolgreich');
    }));

    it('should not confirm reset when passwords do not match', async () => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        const auth = TestBed.inject(AuthService);
        const confirmSpy = spyOn(auth, 'confirmPasswordReset').and.resolveTo();
        app.openResetPasswordOverlay('abc-code');
        app.resetPasswordForm.patchValue({
            newPassword: 'Strong!Pass1',
            confirmPassword: 'Strong!Pass2',
        });

        await app.confirmPasswordResetFromLink();

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(app.showResetPasswordError).toBeTrue();
    });

    it('should show register password error only after register submit attempt', async () => {
        const fixture = TestBed.createComponent(AppComponent);
        const app = fixture.componentInstance;
        app.enterRegisterMode();
        app.loginForm.patchValue({
            displayName: 'Tester',
            email: 'test@example.com',
            password: 'ABCDEF!1',
        });
        app.passwordControl.markAsTouched();

        expect(app.showPasswordError).toBeFalse();

        await app.onSubmit('register');

        expect(app.showPasswordError).toBeTrue();
    });
});
