import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';
import { environment } from './environments/environment';

// Global error handler for debugging
if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        console.error('[GLOBAL ERROR HANDLER] Uncaught error:', event.error);
        console.error('[GLOBAL ERROR HANDLER] Error message:', event.message);
        console.error('[GLOBAL ERROR HANDLER] File:', event.filename);
        console.error('[GLOBAL ERROR HANDLER] Line:', event.lineno);
    });

    window.addEventListener('unhandledrejection', (event) => {
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
