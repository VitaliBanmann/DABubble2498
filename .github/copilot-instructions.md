# Copilot Instructions for DA_Bubble

Diese Regeln gelten für alle Änderungen im Projekt und sind vor einem Deployment zu beachten.

## UI/Interaktion

- Prüfe, dass alle Links und Buttons funktionieren.
- Buttons müssen `cursor: pointer;` besitzen.
- Beachte bei Buttons die States `enabled`, `disabled` und `hover`.

## Code-Qualität

- Eine Funktion hat nur eine Aufgabe (Single Responsibility).
- Eine Funktion ist maximal 14 Zeilen lang.
- Funktionsnamen sind in `camelCase` geschrieben.

## Formulare

- Leere Inputs müssen valide behandelt werden.
- Zeige spezifische Fehlermeldungen im UI (keine `alert()`-Meldungen, keine reine HTML5-Default-Validierung als einziges Feedback).

## Vor Deployment

- Vor Deployment immer lokale Prüfung ausführen:
  - `npm run predeploy:check`

## Sicherheit

- Keine Secrets oder private Keys im Repository committen.
- Keine unsicheren Konstrukte wie `eval`, `new Function` oder ungesicherte HTML-Injektion verwenden.
- Firebase Rules dürfen keine globalen `allow ...: if true;` Schreibfreigaben enthalten.

Diese Regeln sind verbindlich für neuen und geänderten Code.