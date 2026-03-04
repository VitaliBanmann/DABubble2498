import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './services/auth.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';

class MockAuthService {
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

    getCurrentUser() {
        return null;
    }
}

class MockPresenceService {
    startTracking(): void {}
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
});
