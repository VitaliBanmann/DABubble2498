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
  teamMembers = LEGAL_TEAM_MEMBERS;
  legalContact = LEGAL_CONTACT_INFO;
}
