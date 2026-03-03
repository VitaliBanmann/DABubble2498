# Predeploy Manual Checklist

Vor jedem Deployment zusätzlich zum automatischen Check:

- [ ] Funktionieren alle Links und Buttons in den geänderten Views?
- [ ] Haben Buttons die Eigenschaft `cursor: pointer;`?
- [ ] Sind Button-States sichtbar und korrekt (`enabled`, `disabled`, `hover`)?
- [ ] Sind leere Form-Inputs korrekt validiert?
- [ ] Bekommen Nutzer spezifische Fehlermeldungen im UI (keine `alert()`, keine reine HTML5-Defaultmeldung)?

## Pflichtbefehl vor Deployment

```bash
npm run predeploy:check
```