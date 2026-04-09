import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_TEAM_MEMBERS } from '../legal-team-members';
import { LEGAL_CONTACT_INFO } from '../legal-contact';

@Component({
  selector: 'app-datenschutz',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './datenschutz.component.html',
  styleUrl: './datenschutz.component.scss'
})
export class DatenschutzComponent {
  /** Team members shown in legal/privacy sections. */
  teamMembers = LEGAL_TEAM_MEMBERS;
  /** Legal contact details shown in the view. */
  legalContact = LEGAL_CONTACT_INFO;
}
