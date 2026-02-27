import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';
import { environment } from './environments/environment';

const CHUNK_RELOAD_GUARD_KEY = 'da-bubble-chunk-reload-attempted';

function isChunkLoadError(reason: unknown): boolean {
    const message =
        typeof reason === 'string'
            ? reason
            : reason instanceof Error
              ? reason.message
              : '';

    return /failed to fetch dynamically imported module|chunkloaderror|loading chunk|importing a module script failed|module script/i.test(
        message,
    );
}

function tryRecoverFromChunkError(reason: unknown): boolean {
    if (typeof window === 'undefined' || !isChunkLoadError(reason)) {
        return false;
    }

    const hasReloaded = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === '1';

    if (!hasReloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
        window.location.reload();
        return true;
    }

    sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
    return false;
}

if (typeof window !== 'undefined') {
    sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);

    window.addEventListener('error', (event) => {
        const recovered = tryRecoverFromChunkError(event.error ?? event.message);
        if (!recovered) {
            console.error('[GLOBAL ERROR HANDLER] Uncaught error:', event.error);
        }
    });

    window.addEventListener('unhandledrejection', (event) => {
        const recovered = tryRecoverFromChunkError(event.reason);
        if (recovered) {
            event.preventDefault();
            return;
        }

        console.error(
            '[GLOBAL REJECTION HANDLER] Unhandled promise rejection:',
            event.reason,
        );
    });
}

bootstrapApplication(AppComponent, {
    providers: [
        ...appConfig.providers,
        provideFirebaseApp(() => initializeApp(environment.firebase)),
        provideAuth(() => getAuth()),
        provideFirestore(() => getFirestore()),
        provideAnalytics(() => getAnalytics()),
    ],
}).catch((err) => console.error(err));
