import { Routes } from '@angular/router';
import { ImpressumComponent } from './impressum/impressum.component';
import { DatenschutzComponent } from './datenschutz/datenschutz.component';
import { ShellComponent } from './layout/shell/shell.component';

export const routes: Routes = [
  // Auth bleibt weiterhin "/" (wird über AppComponent.showAuthScreen gerendert)

  // Bestehender Login-Redirect soll weiter funktionieren
  { path: 'home', pathMatch: 'full', redirectTo: 'app' },

  // Legal bleibt
  { path: 'impressum', component: ImpressumComponent },
  { path: 'datenschutz', component: DatenschutzComponent },

  // Slack UI Bereich unter /app
  {
    path: 'app',
    component: ShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./home/home.component').then((m) => m.HomeComponent),
      },
      // Später:
      // { path: 'channel/:channelId', loadComponent: ... },
      // { path: 'dm/:userId', loadComponent: ... },
    ],
  },

  // Fallback
  { path: '**', redirectTo: '' },
];
