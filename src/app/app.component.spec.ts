import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { AuthService } from './services/auth.service';

class MockAuthService {
  registerWithEmailAndPassword(): Promise<void> {
    return Promise.resolve();
  }

  loginWithEmailAndPassword(): Promise<void> {
    return Promise.resolve();
  }

  loginWithGoogle(): Promise<void> {
    return Promise.resolve();
  }
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: AuthService, useClass: MockAuthService }]
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
    expect(compiled.querySelector('h1')?.textContent).toContain('Anmeldung');
    expect(compiled.querySelector('input[type="email"]')).not.toBeNull();
    expect(compiled.querySelector('input[type="password"]')).not.toBeNull();
  });
});
