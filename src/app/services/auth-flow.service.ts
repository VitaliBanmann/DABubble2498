import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { User } from 'firebase/auth';
import { firstValueFrom, take } from 'rxjs';
import { AuthService } from './auth.service';
import { ChannelService } from './channel.service';
import { PresenceService } from './presence.service';
import { UserService } from './user.service';

@Injectable({
    providedIn: 'root',
})
export class AuthFlowService {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly channelService: ChannelService,
        private readonly presenceService: PresenceService,
        private readonly router: Router,
    ) {}

    async handleAuthState(user: User | null, currentPath: string): Promise<void> {
        if (!user) {
            await this.redirectToLoginIfProtected(currentPath);
            return;
        }

        await this.syncEmailFromAuth();
        if (!user.isAnonymous) {
            await this.channelService.ensureDefaultChannels();
        }
        if (this.isLoginPath(currentPath)) {
            await this.navigateAfterLogin();
        }
    }

    async navigateAfterLogin(): Promise<void> {
        const user = this.authService.getCurrentUser();
        if (!user) {
            await this.router.navigateByUrl('/');
            return;
        }

        if (user.isAnonymous) {
            await this.router.navigateByUrl('/app');
            return;
        }

        const profile = await firstValueFrom(this.userService.getUser(user.uid).pipe(take(1)));
        await this.router.navigateByUrl(profile?.avatar ? '/home' : '/avatar-select');
    }

    async syncEmailFromAuth(fallbackEmail = ''): Promise<void> {
        const user = this.authService.getCurrentUser();
        if (!user || user.isAnonymous) {
            return;
        }

        const email = this.resolveEmail(user, fallbackEmail);
        if (!email) {
            return;
        }

        await this.userService.updateCurrentUserProfile({ email });
    }

    async logoutToLogin(): Promise<void> {
        await this.presenceService.setStatus('offline');
        await this.authService.logout();
        await this.router.navigateByUrl('/');
        if (typeof window !== 'undefined') {
            window.location.assign('/');
        }
    }

    private async redirectToLoginIfProtected(path: string): Promise<void> {
        if (!this.isProtectedPath(path)) {
            return;
        }

        await this.router.navigateByUrl('/');
        if (typeof window !== 'undefined') {
            window.location.assign('/');
        }
    }

    private isLoginPath(path: string): boolean {
        const normalized = this.normalizePath(path);
        return normalized === '/' || normalized === '';
    }

    private isProtectedPath(path: string): boolean {
        const normalized = this.normalizePath(path);
        return (
            normalized.startsWith('/app')
            || normalized.startsWith('/home')
            || normalized.startsWith('/avatar-select')
        );
    }

    private normalizePath(path: string): string {
        return (path || '').split('?')[0];
    }

    private resolveEmail(user: User, fallbackEmail: string): string {
        const direct = (user.email ?? '').trim();
        if (direct) {
            return direct;
        }

        const providerEmail = user.providerData.find(
            (provider) => (provider.email ?? '').trim().length > 0,
        )?.email;
        return (providerEmail ?? fallbackEmail ?? '').trim();
    }
}
