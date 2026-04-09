/** Contact details for legal/privacy pages. */
export interface LegalContactInfo {
    contactEmail: string;
    privacyEmail: string;
    phone?: string;
}

/** Static legal contact data rendered in legal views. */
export const LEGAL_CONTACT_INFO: LegalContactInfo = {
    contactEmail: 'vitali.banmann@gmail.com',
    privacyEmail: 'vitali.banmann@gmail.com'
};
