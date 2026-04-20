import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.authReady$.pipe(
        filter((ready) => ready),
        take(1),
        switchMap(() => authService.currentUser$.pipe(take(1))),
        map((user) => (user ? true : router.createUrlTree(['/']))),
    );
};
