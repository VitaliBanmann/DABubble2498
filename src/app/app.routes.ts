import { Routes } from '@angular/router';
import { ImpressumComponent } from './impressum/impressum.component';
import { DatenschutzComponent } from './datenschutz/datenschutz.component';
import { HomeComponent } from './home/home.component';
import { AvatarSelectComponent } from './avatar-select/avatar-select.component';
import { ChatLayoutComponent } from './shared/chat-layout/chat-layout.component';

export const routes: Routes = [
  { path: 'home', component: ChatLayoutComponent },
  { path: 'avatar-select', component: AvatarSelectComponent },
  { path: 'impressum', component: ImpressumComponent },
  { path: 'datenschutz', component: DatenschutzComponent }
];
