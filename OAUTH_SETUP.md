# Google OAuth Consent Screen Setup für DA Bubble

## Schritt 1: Google Cloud Console öffnen
1. Gehe zu https://console.cloud.google.com/
2. Projekt "da-bubble-2498" auswählen (oben links, Dropdown)

## Schritt 2: OAuth Consent Screen konfigurieren
1. Linke Seite: "APIs & Services" → "OAuth consent screen"
2. Wähle "External" (User type) - nicht "Internal"
3. Klick "Create"

### Formular ausfüllen:
- **App Name**: "DA Bubble"
- **User support email**: deine E-Mail (die du auch als Developer nutzt)
- **Developer contact information**: Deine E-Mail
- **Klick: Save and Continue**

## Schritt 3: Scopes hinzufügen
- **Authorized scopes**: Folgende 2 hinzufügen:
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
- **Klick: Save and Continue**

## Schritt 4: Test Users hinzufügen (kritisch!)
- **Test users**: Deine Google-E-Mail-Adresse hinzufügen
  - Klick: "+ Add users"
  - Gib deine E-Mail ein
  - Klick: "Add"
- **Klick: Save and Continue**

## Schritt 5: OAuth Credentials prüfen
1. Linke Seite: "Credentials"
2. Suche nach "Web application" Client ID für dein Projekt
3. Klick darauf → prüfe:
   - **Authorized redirect URIs** müssen enthalten:
     - `https://da-bubble-2498.firebaseapp.com/__/auth/handler`
     - `http://localhost:4200/__/auth/handler` (für local dev)
   - Falls nicht: hinzufügen und "Save"

## Schritt 6: Firebase verifizieren
1. Gehe zu https://console.firebase.google.com/
2. Projekt "da-bubble-2498", "Authentication" → "Sign-in method"
3. Google-Provider öffnen → prüfe:
   - `Enabled` = ON
   - `Project support email` ist gesetzt
   - **Klick: Save**

## Schritt 7: Test
- Browser: **Ctrl+Shift+Delete** (Browser-Cache komplett leeren)
- Neu laden
- "Anmelden mit Google" klicken
- Sollte jetzt funktionieren

---

## Falls noch "The requested action is invalid.":
- OAuth Consent Screen muss auf "External" sein (nicht "Internal")
- Dein Google-Account muss in "Test users" eingetragen sein
- Redirect URIs müssen exakt stimmen (kein Typo)

Falls weiterhin fehlschlägt: Schreib den neuen exakten Fehlertext aus dem Popup.
