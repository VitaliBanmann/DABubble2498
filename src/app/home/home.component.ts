import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UiStateService } from '../services/ui-state.service';

@Component({
    selector: 'app-home',
    standalone: true,
    templateUrl: './home.component.html',
    styleUrl: './home.component.scss',
})
export class HomeComponent {
    constructor(
        private readonly authService: AuthService,
        private readonly router: Router,
        private readonly ui: UiStateService,
    ) {}

    openThread(): void {
        this.ui.openThread();
    }
    closeThread(): void {
        this.ui.closeThread();
    }

    async logout(): Promise<void> {
        await this.authService.logout();
        await this.router.navigateByUrl('/');
    }
}
