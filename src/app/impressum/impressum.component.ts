import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_TEAM_MEMBERS } from '../legal-team-members';

@Component({
  selector: 'app-impressum',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './impressum.component.html',
  styleUrl: './impressum.component.scss'
})
export class ImpressumComponent {
  teamMembers = LEGAL_TEAM_MEMBERS;
}
