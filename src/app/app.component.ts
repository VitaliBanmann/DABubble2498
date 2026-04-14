import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { AppAuthBase } from './app-auth.base';
import { AuthFlowService } from './services/auth-flow.service';
import { AuthService } from './services/auth.service';
import { PasswordResetFlowService } from './services/password-reset-flow.service';
import { PresenceService } from './services/presence.service';
import { UserService } from './services/user.service';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterLink, RouterOutlet],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
})
export class AppComponent extends AppAuthBase {
    constructor(
        formBuilder: FormBuilder,
        authFlow: AuthFlowService,
        authService: AuthService,
        userService: UserService,
        resetFlow: PasswordResetFlowService,
        presenceService: PresenceService,
        router: Router,
        cdr: ChangeDetectorRef,
        ngZone: NgZone,
    ) {
        super(
            formBuilder,
            authFlow,
            authService,
            userService,
            resetFlow,
            presenceService,
            router,
            cdr,
            ngZone,
        );

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
}
