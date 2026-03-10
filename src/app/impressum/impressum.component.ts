import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_TEAM_MEMBERS } from '../legal-team-members';
import { LEGAL_CONTACT_INFO } from '../legal-contact';

@Component({
    selector: 'app-impressum',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './impressum.component.html',
    styleUrl: './impressum.component.scss',
})
export class ImpressumComponent {
    teamMembers = LEGAL_TEAM_MEMBERS;
    legalContact = LEGAL_CONTACT_INFO;
}
