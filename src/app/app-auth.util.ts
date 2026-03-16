export const AUTH_ERROR_MESSAGES: Record<string, string> = {
    'auth/popup-closed-by-user':
        'Google-Popup wurde geschlossen. Bitte erneut versuchen.',
    'auth/popup-blocked':
        'Popup wurde blockiert. Bitte Popup-Blocker deaktivieren und erneut versuchen.',
    'auth/unauthorized-domain':
        'Domain nicht autorisiert. Bitte Firebase Authorized Domains prüfen.',
    'auth/operation-not-allowed':
        'Anmeldemethode ist in Firebase nicht aktiviert.',
    'auth/admin-restricted-operation':
        'Diese Anmeldung ist aktuell eingeschränkt. Firebase-Konfiguration prüfen.',
    'auth/invalid-email':
        'Ungültige E-Mail-Adresse. Bitte überprüfe deine Eingabe.',
    'auth/wrong-password': 'Falsches Passwort. Bitte versuche es erneut.',
    'auth/user-not-found': 'Kein Konto mit dieser E-Mail gefunden.',
    'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
    'auth/network-request-failed':
        'Netzwerkfehler. Bitte Internet/Firebase-Setup prüfen.',
};

export function parseFirebaseError(
    error: unknown,
): { code: string; message: string } {
    const firebaseError = error as {
        code?: string;
        message?: string;
    } | null;

    return {
        code: firebaseError?.code ?? '',
        message: firebaseError?.message ?? '',
    };
}

export function formatFallbackError(
    fallback: string,
    code: string,
    message: string,
): string {
    return message ? `${fallback} (${code}: ${message})` : `${fallback} (${code})`;
}
