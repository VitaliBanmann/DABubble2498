# 💬 DA Bubble - Angular Chat App

> Echtzeit-Chat-Anwendung mit Angular und Firebase. Team-Kommunikation auf modernem Standard.

## 🎯 Features

- ✅ **Echtzeit-Nachrichten** - Firebase Realtime Database
- ✅ **Direktnachrichten** - 1-zu-1 Konversationen
- ✅ **Kanäle** - Team-basierte Kommunikation
- ✅ **Benutzer-Management** - Authentifizierung & Profile
- ✅ **File Sharing** - Datei-Upload möglich
- ✅ **Responsive UI** - Modern & Benutzerfreundlich
- ✅ **Search-Funktionalität** - Nachrichten durchsuchen

## 🔧 Tech Stack

- **Frontend:** Angular 17+
- **Backend:** Firebase/Firestore
- **Authentifizierung:** Firebase Auth
- **Echtzeit:** Firebase Realtime Database
- **Storage:** Firebase Cloud Storage

## 🚀 Installation & Setup

```bash
# 1. Dependencies installieren
npm install

# 2. Firebase konfigurieren
# Siehe: FIREBASE_SETUP.md

# 3. Dev-Server starten (http://localhost:4200)
npm start

# 4. Tests ausführen
npm test
```

## 📖 Dokumentation

| Dokument | Beschreibung |
|----------|-------------|
| [docs/project-dokumentation.md](docs/project-dokumentation.md) | Vollständige Projekt-Doku |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Firebase Konfiguration |
| [FIREBASE_EMAIL_TEMPLATE.md](FIREBASE_EMAIL_TEMPLATE.md) | Email-Vorlagen |
| [docs/predeploy-manual-checklist.md](docs/predeploy-manual-checklist.md) | Pre-Deploy Checkliste |

## 🎮 Verwendung

1. **Registrierung:** Neues Konto erstellen
2. **Login:** Mit Email & Passwort anmelden
3. **Nachrichten:** In Kanälen oder privat schreiben
4. **Profile:** Benutzer-Informationen bearbeiten

## 🔨 Wichtige Befehle

```bash
npm start              # Dev-Server
npm test              # Unit Tests
npm run build         # Production Build
npm run predeploy:check  # Pre-Deploy Checks
firebase deploy       # Deploy zu Firebase
```

## 🚢 Deployment

**Vor jedem Deployment:**

1. Pre-Deploy Check: `npm run predeploy:check`
2. UI-Überprüfung gemäß Checkliste
3. Deploy: `firebase deploy`

## 📁 Projektstruktur

```
src/
├── app/
│   ├── components/    # UI-Komponenten
│   ├── pages/        # Seiten
│   ├── services/     # Firebase & API Services
│   ├── guards/       # Route Guards
│   └── models/       # Data Models
├── assets/           # Bilder & Icons
├── environments/     # Firebase Config
└── styles/          # Globale Styles
```

## 🆘 Support

Bei Fragen oder Issues: [GitHub Issues](https://github.com/VitaliBanmann/DABubble2498/issues)

---

_Eine professionelle Chat-Anwendung mit Angular & Firebase._
