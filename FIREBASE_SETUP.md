# DA-Bubble 2498

Ein modernes Angular-Chat-Anwendungsprojekt mit Firebase-Integration.

## 🚀 Features

- **Firebase Authentication** - Benutzer-Registrierung und Login
- **Firestore Database** - Echtzeitdatenbank für Nachrichten und Benutzer
- **Real-time Updates** - Live-Chat mit WebSocket-Kommunikation
- **User Management** - Benutzerverwaltung und Profile

## 📦 Installation

```bash
npm install
```

## 🔧 Konfiguration & Setup

### Firebase Projekt
Projekt-Name: **DA-Bubble 2498** in Firebase Console

**WICHTIG – Initiales Setup für neues Projekt:**

1. **Authentication aktivieren:**
   - Gehe zu **Authentication > Sign-in method**
   - Aktiviere: **Email/Passwort**, **Google**, **Anonymous**
   - Status aller drei sollte grün sein (Aktiviert)

2. **Authorized Domains konfigurieren:**
   - Gehe zu **Authentication > Settings > Authorized domains**
   - Füge folgende Domains hinzu:
     - `da-bubble-da44d.web.app` (Production)
     - `da-bubble-da44d--test-*.web.app` (Test-Channels)
   - **Hinweis:** `localhost:4200` kann **nicht** hinzugefügt werden (Firebase-Limitierung)
   - Für lokale Entwicklung nutze stattdessen:
     - Test-URL: `https://da-bubble-da44d--test-*.web.app` zum Testen
     - Oder: Optional Firebase Emulator Suite für vollständigen lokalen Stack

### Firebase Konfiguration

Die Firebase-Konfiguration befindet sich in:
- `src/environments/environment.ts` - Development
- `src/environments/environment.prod.ts` - Production

```typescript
// Aktuelle Firebase Config (Projekt: da-bubble-da44d):
export const environment = {
    production: false,
    firebase: {
        apiKey: 'AIzaSyDIPLROscPNuutE4s6a3fwCVHJBt1_ewnY',
        authDomain: 'da-bubble-da44d.firebaseapp.com',
        projectId: 'da-bubble-da44d',
        storageBucket: 'da-bubble-da44d.firebasestorage.app',
        messagingSenderId: '957279222682',
        appId: '1:957279222682:web:ac8ec6b50fce511f239823',
    },
};
```

## 📁 Projektstruktur

```
src/
├── app/
│   ├── services/
│   │   ├── firebase.service.ts      - Firebase Initialization
│   │   ├── auth.service.ts          - Authentifizierung
│   │   └── firestore.service.ts     - Firestore CRUD Operationen
│   ├── app.config.ts                - Firebase Provider Setup
│   └── ...
├── environments/
│   ├── environment.ts               - Development Config
│   └── environment.prod.ts          - Production Config
└── ...
```

## 🔐 Firebase Services

### AuthService
Verwaltet die Benutzerauthentifizierung:
- `registerWithEmailAndPassword()` - Neuen Benutzer erstellen
- `loginWithEmailAndPassword()` - Anmelden
- `logout()` - Abmelden
- `getCurrentUser()` - Aktuellen Benutzer abrufen
- `currentUser$` - Observable für Benutzeränderungen

### FirestoreService
CRUD-Operationen für Firestore:
- `addDocument()` - Doument hinzufügen
- `getDocuments()` - Alle Dokumente abrufen
- `getDocument()` - Einzelnes Dokument abrufen
- `updateDocument()` - Dokument aktualisieren
- `deleteDocument()` - Dokument löschen
- `queryDocuments()` - Mit Filtern abfragen

## 🚀 Development Server

```bash
npm start
```

Navigiere zu `http://localhost:4200/`

## 🏗️ Build

```bash
npm run build
```

## 📝 .gitignore

Folgende Dateien sind vom Git ausgeschlossen:
- `.env` - Umgebungsvariablen
- `src/environments/environment.local.ts` - Lokale Konfiguration
- `firebase-debug.log` - Firebase Debug Logs
- `node_modules/` - Dependencies
- `.firebaserc` - Firebase RC Datei

## 🔄 Firestore Struktur (Optional)

Du kannst folgende Collections erstellen:

```
users/
├── {userId}/
│   ├── email: string
│   ├── displayName: string
│   ├── avatar: string
│   └── createdAt: timestamp

messages/
├── {messageId}/
│   ├── text: string
│   ├── sender: string (userId)
│   ├── receiver: string (userId)
│   ├── timestamp: timestamp
│   └── read: boolean

channels/
├── {channelId}/
│   ├── name: string
│   ├── description: string
│   ├── members: array
│   └── createdAt: timestamp
```

## 🛠️ Entwicklung

1. Verwende `AuthService` für Authentifizierung
2. Verwende `FirestoreService` für Datenbankoperationen
3. Alle Services sind als `providedIn: 'root'` konfiguriert (Singleton)

## 📚 Weitere Ressourcen

- [Firebase Documentation](https://firebase.google.com/docs)
- [AngularFire Documentation](https://github.com/angular/angularfire)
- [Angular Documentation](https://angular.io/docs)

## 📄 Lizenz

MIT
