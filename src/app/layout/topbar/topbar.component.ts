import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';
import { UiStateService } from '../../services/ui-state.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';

@Component({
    selector: 'app-topbar',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './topbar.component.html',
    styleUrl: './topbar.component.scss',
})
export class TopbarComponent implements OnInit, OnDestroy {
    displayName = 'Gast';
    avatarUrl = 'assets/pictures/profil_m1.svg';
    showUserMenu = false;
    private readonly subscription = new Subscription();

    constructor(
        public readonly ui: UiStateService,
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly router: Router,
    ) {}

    ngOnInit(): void {
        this.subscription.add(
            this.authService.currentUser$
                .pipe(
                    switchMap((user) => {
                        if (!user || user.isAnonymous) {
                            this.displayName = 'Gast';
                            this.avatarUrl = 'assets/pictures/profil_m1.svg';
                            return [];
                        }

                        this.displayName =
                            user.displayName?.trim() ||
                            user.email?.split('@')[0] ||
                            'Gast';

                        // Kontinuierlich Profil-Updates laden mit Real-time Listener
                        return this.userService.getUserRealtime(user.uid);
                    }),
                )
                .subscribe({
                    next: (profile) => {
                        if (!profile) {
                            return;
                        }
                        const profileName = profile.displayName?.trim();
                        if (profileName) {
                            this.displayName = profileName;
                        }
                        if (profile.avatar) {
                            this.avatarUrl = profile.avatar;
                        }
                    },
                }),
        );
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    toggleUserMenu(): void {
        this.showUserMenu = !this.showUserMenu;
    }

    closeUserMenu(): void {
        this.showUserMenu = false;
    }

    navigateToProfile(): void {
        this.closeUserMenu();
        void this.router.navigateByUrl('/avatar-select');
    }

    async logout(): Promise<void> {
        this.closeUserMenu();
        await this.authService.logout();
        void this.router.navigateByUrl('/');
    }
}
