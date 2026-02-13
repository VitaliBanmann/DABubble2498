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

## 🔧 Konfiguration

### Firebase Setup

Die Firebase-Konfiguration befindet sich in:
- `src/environments/environment.ts` - Development
- `src/environments/environment.prod.ts` - Production

```typescript
// Deine Firebase Config ist bereits konfiguriert mit:
const firebaseConfig = {
  apiKey: "AIzaSyD5LEf5q6fnxSwlgxFtStf2PkUI-YT0leU",
  authDomain: "da-bubble-2498.firebaseapp.com",
  projectId: "da-bubble-2498",
  storageBucket: "da-bubble-2498.firebasestorage.app",
  messagingSenderId: "631540867204",
  appId: "1:631540867204:web:8faff42021b25671cd22d1",
  measurementId: "G-YER8LDLW0Y"
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
