/** Team member shown in legal/privacy pages. */
export interface LegalTeamMember {
    name: string;
    email: string;
}

/** Static list of legal team contacts. */
export const LEGAL_TEAM_MEMBERS: LegalTeamMember[] = [
    { name: 'Vitali Banmann', email: 'vitali.banmann@gmail.com' },
    { name: 'Friedrich Faraji', email: 'fri.faraji@gmail.com' },
    { name: 'Ugursay Pürcek', email: 'ugursay.puercek@gmail.com' },
    { name: 'Danny Gruchmann', email: 'dannygruchmann12345@gmail.com' },
];
