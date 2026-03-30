# DA Bubble Projekt-Dokumentation

Diese Dokumentation beschreibt Architektur, Setup, Betrieb, Deployment und Entwicklungsstandards fuer das Projekt DA Bubble.

## 1. Projektueberblick

DA Bubble ist eine Chat-Anwendung auf Basis von Angular und Firebase mit folgenden Schwerpunkten:

- Authentifizierung mit Email/Passwort, Google und Gast-Login
- Channel- und Direktnachrichten (DM)
- Echtzeit-Messaging mit Firestore
- Threads auf Channel-Nachrichten
- Reactions, Mentions und Attachments
- Praesenzanzeige (online, away, offline)
- Firebase Hosting inkl. Firestore- und Storage-Rules

## 2. Tech-Stack

- Frontend: Angular 21 (Standalone Components, Angular Signals, RxJS)
- UI: Angular Material (Teilbereiche), Emoji Picker (`@ctrl/ngx-emoji-mart`)
- Backend as a Service: Firebase
- Auth: Firebase Authentication
- Datenbank: Cloud Firestore
- Dateiablage: Firebase Storage
- Hosting: Firebase Hosting
- Optional SSR-Server: Angular SSR + Express

## 3. Projektstruktur

Top-Level:

- `src/`: Frontend-Quellcode
- `src/app/`: Komponenten, Routen, Services
- `src/environments/`: Environment-Konfiguration
- `scripts/`: Projektinterne Quality- und Predeploy-Checks
- `docs/`: Projektdokumentation
- `firestore.rules`, `storage.rules`: Security Rules
- `firebase.json`: Hosting-, Firestore- und Storage-Konfiguration

Wichtige Bereiche in `src/app/`:

- `app.component.*`: Einstieg, Auth-Screen, Login/Registrierung/Passwort-Reset
- `app.routes.ts`: Routing fuer Legal-Seiten, Avatar-Auswahl, App-Shell
- `layout/shell/`: Hauptlayout mit Sidebar, Topbar und Thread-Pane
- `home/`: Chat-View (Channel/DM, Composer, Message-Liste)
- `services/`: Domain- und Infrastruktur-Services

## 4. Architektur

### 4.1 Frontend-Architektur

Die Anwendung ist komponenten- und serviceorientiert aufgebaut:

- UI-Komponenten steuern Darstellung und Benutzerinteraktion.
- Services kapseln Auth, Datenzugriff, Business-Logik und UI-State.
- Firestore-Streams liefern Realtime-Daten ueber RxJS Observables.
- UI-Zustaende (z. B. Sidebar, Thread) werden mit Angular Signals verwaltet.

### 4.2 Routing

Das Routing trennt Legal-Bereiche und App-Bereich:

- `/`: Auth-Screen (wird in der Root-Komponente gesteuert)
- `/impressum`, `/datenschutz`: Rechtliche Seiten
- `/avatar-select`: Avatar-Auswahl
- `/app`: Shell-Bereich
- `/app/channel/:channelId`: Channel-Chat
- `/app/dm/:userId`: Direktnachrichten

Hinweise:

- `/home` wird auf `/app` umgeleitet.
- Fallback-Route leitet auf `/`.

### 4.3 Shell + Home-Ansatz

- Die Shell-Komponente hostet Sidebar, Topbar und Router-Outlet.
- Die Home-Komponente bedient den Chat-Kontext (Channel oder DM).
- Thread-Interaktionen laufen kontextbezogen ueber den UI-State-Service.
- Die Home-Logik ist in Base-Klassen aufgeteilt (`home-*.base.ts`) fuer bessere Trennung von Verantwortlichkeiten.

## 5. Kern-Services

### 5.1 AuthService

Zustaendig fuer:

- Registrierung und Login (Email/Passwort)
- Google-Login
- Gast-Login (anonym)
- Logout
- Password-Reset (Email senden, Passwort bestaetigen)
- Auth-State-Tracking ueber `currentUser$`

### 5.2 FirestoreService

Kapselt Firestore-Operationen:

- `addDocument`, `setDocument`, `getDocument`, `getDocuments`
- `updateDocument`, `deleteDocument`
- `queryDocuments`, `queryDocumentsRealtime`
- Realtime-Streams mit Retry bei temporarem `unauthenticated`

### 5.3 UserService

- CRUD auf `users`
- Profil-Synchronisation mit Firebase Auth
- Realtime-Benutzerdaten
- Suche ueber Search-Tokens
- Presence-Updates (Status + lastSeen)

### 5.4 ChannelService

- CRUD auf `channels`
- Mitgliederverwaltung
- Suchfunktion ueber Token
- Sicherstellung von Standardkanaelen (`allgemein`, `entwicklerteam`)

### 5.5 MessageService

- Channel- und DM-Nachrichten senden/lesen
- Paging fuer neueste/aeltere Nachrichten
- Suche ueber Search-Tokens
- Bearbeiten, Loeschen, Read-Status
- Thread-Nachrichten unter `messages/{messageId}/threads`
- Reactions (toggle)

### 5.6 Weitere Services

- `AttachmentService`: Upload/Metadaten fuer Dateianhaenge
- `PresenceService`: Browser-/Visibility-basiertes Presence-Tracking
- `UnreadStateService`: Lesestatus/Inbox-State je Kontext
- `UiStateService`: Shell-/Thread-/Composer-UI-Zustaende
- `AuthFlowService`: App-spezifische Navigation und Profil-Sync nach Auth-Events

## 6. Datenmodell (Firestore)

### 6.1 Collection `users`

Typische Felder:

- `email: string`
- `displayName: string`
- `avatar?: string`
- `presenceStatus?: 'online' | 'away' | 'offline'`
- `lastSeen?: Date`
- `createdAt?: Date`
- `updatedAt?: Date`
- `searchTokens?: string[]`

Subcollection:

- `users/{userId}/inboxState/{contextId}` fuer Lese-/Kontextstatus

### 6.2 Collection `channels`

Typische Felder:

- `name: string`
- `description?: string`
- `members: string[]`
- `admins?: string[]`
- `createdBy: string`
- `createdAt?: Date`
- `updatedAt?: Date`
- `avatar?: string`
- `searchTokens?: string[]`

### 6.3 Collection `messages`

Typische Felder:

- `text: string`
- `senderId: string`
- Kontextfelder:
- Channel: `channelId`
- DM: `receiverId` + `conversationId`
- `timestamp: Timestamp | Date`
- `read?: boolean`
- `edited?: boolean`, `editedAt?: Date`
- `reactions?: { emoji: string; userIds: string[] }[]`
- `mentions?: string[]`
- `attachments?: MessageAttachment[]`
- `searchTokens?: string[]`
- `threadReplyCount?: number`

Subcollection:

- `messages/{messageId}/threads/{threadId}`

### 6.4 Conversation-ID fuer DMs

DMs verwenden eine deterministische `conversationId` aus zwei User-IDs in sortierter Reihenfolge:

- `uidA__uidB` (lexikografisch sortiert)

## 7. Security

## 7.1 Firestore Rules

Kernaussagen aus `firestore.rules`:

- Standard: deny-all fuer unbekannte Pfade
- Zugriff nur fuer authentifizierte User
- Anonyme User werden fuer schreibende Kernoperationen eingeschraenkt
- Channel-Lesen nur fuer oeffentliche Kanaele oder Mitglieder
- Channel-Verwaltung nur Owner/Admin
- Nachrichtenzugriff nur fuer berechtigte Channel-Mitglieder oder DM-Teilnehmer
- Threads nur unter gueltigen Parent-Messages
- Inbox-State nur im eigenen User-Kontext

## 7.2 Storage Rules

Kernaussagen aus `storage.rules`:

- Lesen nur fuer authentifizierte User
- Avatar-Upload nur fuer eigenen User-Pfad
- Attachment-Upload nur fuer regulaere User
- Attachment-Limit: kleiner als 10 MB
- Erlaubte Content-Types:
- Bilder (`image/*`)
- PDF
- DOCX
- Textdatei (`text/plain`)

## 7.3 Sicherheitsrichtlinien im Projekt

- Keine Secrets und keine Private Keys committen
- Keine unsicheren Patterns wie `eval` oder `new Function`
- Keine ungesicherte HTML-Injektion
- Keine global offenen Firebase-Write-Regeln

Diese Anforderungen werden zusaetzlich durch `scripts/security-check.mjs` validiert.

## 8. Setup

### 8.1 Voraussetzungen

- Node.js LTS
- npm
- Firebase CLI (`firebase-tools`) fuer Deployments
- Zugriff auf das Firebase-Projekt `da-bubble-da44d`

### 8.2 Installation

```bash
npm install
```

### 8.3 Lokale Entwicklung

```bash
npm start
```

Standard-URL:

- `http://localhost:4200`

Weitere Start-Skripte:

- `npm run start:open`
- `npm run start:open:4201`
- `npm run start:safe`

### 8.4 Build

```bash
npm run build
```

Build-Ausgabe:

- `dist/da-bubble/browser`

## 9. Testing

- Unit-Tests lokal: `npm test`
- CI-geeignet: `npm run test:ci`

## 10. Qualitaets-Gates

Pflicht vor Deployment:

```bash
npm run predeploy:check
```

Dieser Sammelcheck fuehrt aus:

1. `scripts/security-check.mjs`
2. `scripts/predeploy-check.mjs`
3. `scripts/redundancy-check.mjs`
4. `scripts/line-limit-check.mjs`
5. `npm run build`

### 10.1 Was wird geprueft?

- Security: kritische Patterns, Secrets, Firebase-Rule-Sicherheit, Audit-Hinweise
- Projektregeln:
- Functions in camelCase
- Funktionslaenge (max. 14 Zeilen, geaenderte Bereiche)
- Hinweise auf SRP-Verstoesse
- Form-Regeln und verbotene `alert()`-Nutzung
- UI-Regeln fuer Buttons (`cursor: pointer`, `:hover`, disabled-State)
- Redundanz: wiederholte grosse Code-Bloecke
- Line-Limit: max. 400 Zeilen fuer `.ts` und `.mjs`

Ergaenzende manuelle Pruefung:

- [docs/predeploy-manual-checklist.md](docs/predeploy-manual-checklist.md)

## 11. Deployment

### 11.1 Standardablauf

1. Branch aktualisieren (`git pull --ff-only`)
2. Pflichtcheck ausfuehren (`npm run predeploy:check`)
3. Manuelle UI-Checks ausfuehren
4. Deployment starten:

```bash
firebase deploy
```

### 11.2 Firebase-Ziele

In `firebase.json` sind konfiguriert:

- Firestore Rules + Indexes
- Storage Rules
- Hosting auf `dist/da-bubble/browser`
- SPA-Rewrite auf `index.html`
- Cache-Header fuer HTML, Assets, JS/CSS

## 12. SSR (optional)

Das Projekt enthaelt SSR-Bausteine:

- `server.ts`: Express + Angular SSR Engine
- `src/main.server.ts`: Server-Bootstrap
- Script `serve:ssr:da-bubble` startet den SSR-Server aus dem Build

Hinweis:

- Das produktive Firebase Hosting ist auf statische Browser-Build-Artefakte ausgerichtet.

## 13. Konfiguration

### 13.1 Environments

- `src/environments/environment.ts` (development)
- `src/environments/environment.prod.ts` (production)

Beide nutzen eine zentrale Firebase-Konfiguration aus `firebase.config.ts`.

### 13.2 Angular Build/Serve

- Projektdefinition in `angular.json`
- Build-Budgets fuer Production sind aktiviert
- Default-Serve-Konfiguration ist `development`

## 14. Betriebswissen

### 14.1 Presence

- Presence wird im Browser ueber Visibility-Events und Heartbeat (45s) gepflegt.
- Bei `beforeunload` wird ein Offline-Status gesetzt.

### 14.2 Chunk-Fehler-Recovery

In `src/main.ts` existiert ein globaler Handler:

- Erkennt typische Dynamic-Import-/Chunk-Load-Fehler
- Fuehrt einmaligen Reload als Recovery durch
- Verhindert Reload-Schleifen ueber Session-Guard

## 15. Bekannte Projektkonventionen

Aus den Projektregeln:

- Funktionen sollen eine klare Aufgabe haben (SRP)
- Funktionsnamen in camelCase
- Leere Form-Inputs valide behandeln
- Spezifische Fehlermeldungen im UI statt `alert()`
- Vor Deploy immer `npm run predeploy:check`

## 16. Verwandte Dokumente

- Firebase Setup: [FIREBASE_SETUP.md](../FIREBASE_SETUP.md)
- Firebase Mail-Templates: [FIREBASE_EMAIL_TEMPLATE.md](../FIREBASE_EMAIL_TEMPLATE.md)
- Manuelle Deploy-Pruefung: [predeploy-manual-checklist.md](predeploy-manual-checklist.md)

## 17. Kurzcheck fuer neue Teammitglieder

1. Repository klonen
2. `npm install`
3. Firebase-Auth-Methoden im Projekt pruefen (Email, Google, Anonymous)
4. `npm start` und Login/Channel/DM lokal pruefen
5. Vor erstem Release `npm run predeploy:check` ausfuehren
6. Deployment nur mit erfolgreichem Check + manueller UI-Pruefung
