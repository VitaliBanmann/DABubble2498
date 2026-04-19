export const PROFILE_EMAIL_KEYS = ['email', 'mail', 'emailAddress', 'eMail'] as const;

export function extractProfileEmail(
    profile: Record<string, unknown> | null,
): string {
    if (!profile) return '';
    for (const key of PROFILE_EMAIL_KEYS) {
        const value = profile[key];
        const email = typeof value === 'string' ? value.trim() : '';
        if (email) return email;
    }
    return '';
}

export function firstNonEmptyString(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const next = (value ?? '').trim();
        if (next) return next;
    }
    return '';
}

export function normalizeAvatarUrl(avatar: string | null | undefined): string | null {
    const trimmed = (avatar ?? '').trim();
    if (!trimmed) return null;
    if (isDirectAvatarUrl(trimmed)) return trimmed;
    return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
}

export function getProfileInitials(name: string): string {
    const normalizedName = name.trim();
    if (!normalizedName) return 'G';
    const parts = normalizedName.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0][0].toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function resizeImageToDataUrl(
    file: File,
    maxSize: number,
    quality: number,
): Promise<string> {
    return readFileAsDataUrl(file).then((source) =>
        loadImage(source).then((img) => renderImageAsJpeg(img, maxSize, quality)),
    );
}

function isDirectAvatarUrl(value: string): boolean {
    return (
        value.startsWith('data:image/')
        || value.startsWith('http://')
        || value.startsWith('https://')
        || value.startsWith('assets/')
    );
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('File could not be read'));
        reader.readAsDataURL(file);
    });
}

function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Invalid image file'));
        image.src = source;
    });
}

function renderImageAsJpeg(
    image: HTMLImageElement,
    maxSize: number,
    quality: number,
): string {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
}