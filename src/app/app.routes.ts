import { Routes } from '@angular/router';

import { ImpressumComponent } from './impressum/impressum.component';
import { DatenschutzComponent } from './datenschutz/datenschutz.component';
import { AvatarSelectComponent } from './avatar-select/avatar-select.component';

import { ShellComponent } from './layout/shell/shell.component';
import { ChatLayoutComponent } from './shared/chat-layout/chat-layout.component';

export const routes: Routes = [
  // /home soll in die App (für Redirects nach Login)
  { path: 'home', pathMatch: 'full', redirectTo: 'app' },

  // Kollegen-Route behalten (falls genutzt)
  { path: 'avatar-select', component: AvatarSelectComponent },

  // Legal
  { path: 'impressum', component: ImpressumComponent },
  { path: 'datenschutz', component: DatenschutzComponent },

  // App-Bereich (Shell)
  {
    path: 'app',
    component: ShellComponent,
    children: [
      // Wenn ihr ChatLayout schon habt, nutzen wir das als Startseite IN der Shell
      { path: '', pathMatch: 'full', component: ChatLayoutComponent },

      // später: channel/dm routes hier rein
      // { path: 'channel/:id', loadComponent: ... },
    ],
  },

  // Fallback -> Login Screen ("/" wird in AppComponent gerendert)
  { path: '**', redirectTo: '' },
];