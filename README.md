# DA Bubble

Zentrale Projekt-Dokumentation fuer die Angular/Firebase-Chat-Anwendung.

## Dokumentation

- Vollstaendige Projekt-Dokumentation: [docs/project-dokumentation.md](docs/project-dokumentation.md)
- Firebase Setup und Betrieb: [FIREBASE_SETUP.md](FIREBASE_SETUP.md)
- Firebase Email Templates: [FIREBASE_EMAIL_TEMPLATE.md](FIREBASE_EMAIL_TEMPLATE.md)
- Manuelle Deployment-Pruefliste: [docs/predeploy-manual-checklist.md](docs/predeploy-manual-checklist.md)

## Schnellstart

1. Abhaengigkeiten installieren:

```bash
npm install
```

2. Development-Server starten:

```bash
npm start
```

3. App im Browser oeffnen:

```text
http://localhost:4200
```

## Wichtige Befehle

- Entwicklung: `npm start`
- Tests: `npm test`
- Build: `npm run build`
- Pflichtcheck vor Deploy: `npm run predeploy:check`
- Deployment: `firebase deploy`

## Deployment-Standard

Vor jedem Deployment muessen ausgefuehrt werden:

1. `npm run predeploy:check`
2. Manuelle UI-Pruefung gemaess [docs/predeploy-manual-checklist.md](docs/predeploy-manual-checklist.md)
3. `firebase deploy`
