import {
    Component,
    EventEmitter,
    Input,
    NgZone,
    OnDestroy,
    OnInit,
    Output,
} from '@angular/core';
import { Subscription, catchError, map, of, startWith, switchMap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';

interface ResolvedProfileView {
    displayName: string;
    email: string;
    avatarUrl: string | null;
}

interface AvatarOption {
    id: string;
    name: string;
    path: string;
}

@Component({
    selector: 'app-show-profile',
    standalone: true,
    templateUrl: './show-profile.component.html',
    styleUrl: './show-profile.component.scss',
})
export class ShowProfileComponent implements OnInit, OnDestroy {
    @Input() initialDisplayName = '';
    @Input() initialEmail = '';
    @Input() initialAvatarUrl: string | null = null;
    @Output() close = new EventEmitter<void>();

    displayName = 'Gast';
    email = '';
    avatarUrl: string | null = null;
    isEditing = false;
    editDisplayName = '';
    isEditNameEmpty = true;
    editAvatarUrl: string | null = null;
    selectedAvatarId: string | null = null;
    uploadedAvatarDataUrl: string | null = null;
    showAvatarPicker = false;
    uploadError = '';
    isSaving = false;
    readonly avatars: AvatarOption[] = [
        { id: 'm1', name: 'Mann 1', path: 'profil_m1.svg' },
        { id: 'm2', name: 'Mann 2', path: 'profil_m2.svg' },
        { id: 'm3', name: 'Mann 3', path: 'profil_m3.svg' },
        { id: 'w1', name: 'Frau 1', path: 'profil_w1.svg' },
        { id: 'w2', name: 'Frau 2', path: 'profil_w2.svg' },
    ];

    private readonly subscription = new Subscription();
    private readonly profileEmailKeys = ['email', 'mail', 'emailAddress', 'eMail'] as const;

    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly zone: NgZone,
    ) {}

    /** Handles ng on init. */
    ngOnInit(): void {
        this.seedViewFromInputs();
        this.subscribeToProfileUpdates();
    }

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    /** Handles request close. */
    requestClose(): void {
        this.close.emit();
    }

    /** Handles enter edit mode. */
    enterEditMode(): void {
        this.isEditing = true;
        this.editDisplayName = this.displayName;
        this.syncNameValidationState();
        this.editAvatarUrl = this.avatarUrl;
        this.selectAvatarFromProfile(this.avatarUrl);
        this.showAvatarPicker = false;
        this.uploadError = '';
    }

    /** Handles exit edit mode. */
    exitEditMode(): void {
        this.isEditing = false;
        this.showAvatarPicker = false;
    }

    /** Handles save profile edit. */
    async saveProfileEdit(): Promise<void> {
        const nextName = this.editDisplayName.trim();
        if (!this.isSaveAllowed(nextName)) return;
        const nextAvatar = this.resolveAvatarForSave();
        this.applyOptimisticProfileAndStartSaving(nextName, nextAvatar);
        await this.persistProfileOrRestoreEdit(nextName, nextAvatar);
        this.setSavingFlag(false);
    }

    /** Handles update edit name draft. */
    updateEditNameDraft(value: string): void {
        this.editDisplayName = value;
        this.syncNameValidationState();
    }

    /** Handles toggle avatar picker. */
    toggleAvatarPicker(): void {
        if (!this.isEditing || this.isSaving) return;
        this.showAvatarPicker = !this.showAvatarPicker;
    }

    /** Handles select avatar in edit mode. */
    selectAvatar(avatarId: string): void {
        if (!this.isEditing || this.isSaving) return;

        this.selectedAvatarId = avatarId;
        this.uploadError = '';

        if (avatarId === 'custom') {
            this.editAvatarUrl = this.uploadedAvatarDataUrl;
            return;
        }

        const selected = this.avatars.find((avatar) => avatar.id === avatarId);
        this.editAvatarUrl = selected ? `assets/pictures/${selected.path}` : null;
    }

    /** Handles upload click. */
    onUploadClick(fileInput: HTMLInputElement): void {
        if (!this.isEditing || this.isSaving) return;
        fileInput.click();
    }

    /** Handles avatar file upload. */
    async handleFileUpload(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
            target.value = '';
            return;
        }

        this.uploadError = '';

        try {
            const dataUrl = await this.resizeImageToDataUrl(file, 512, 0.82);
            this.uploadedAvatarDataUrl = dataUrl;
            this.selectedAvatarId = 'custom';
            this.editAvatarUrl = dataUrl;
            this.showAvatarPicker = true;
        } catch (error) {
            console.error('Avatar upload failed:', error);
            this.uploadError =
                'Das Bild konnte nicht verarbeitet werden. Bitte versuche eine andere Datei.';
        }

        target.value = '';
    }

    /** Returns avatar url for current mode. */
    get activeAvatarUrl(): string | null {
        return this.isEditing ? this.editAvatarUrl : this.avatarUrl;
    }

    /** Returns initials. */
    get initials(): string {
        const name = (this.isEditing ? this.editDisplayName : this.displayName).trim();
        if (!name) {
            return 'G';
        }

        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }

        return parts[0][0].toUpperCase();
    }

    /** Handles subscribe to profile updates. */
    private subscribeToProfileUpdates(): void {
        const stream$ = this.authService.currentUser$.pipe(
            switchMap((user) => this.buildViewStreamForUser(user)),
        );
        this.subscription.add(stream$.subscribe((view) => this.applyResolvedView(view)));
    }

    /** Handles build view stream for user. */
    private buildViewStreamForUser(user: any) {
        if (!user || user.isAnonymous) return of(this.createGuestView());
        return this.userService.getUserProfileRealtime(user.uid, user.email ?? '').pipe(
            startWith(null),
            catchError(() => of(null)),
            map((profile) => this.resolveViewFromProfile(user, profile)),
        );
    }

    /** Handles apply resolved view. */
    private applyResolvedView(view: ResolvedProfileView): void {
        this.displayName = view.displayName;
        this.email = view.email;
        this.avatarUrl = view.avatarUrl;

        if (!this.isEditing) {
            this.editAvatarUrl = view.avatarUrl;
            this.selectAvatarFromProfile(view.avatarUrl);
        }
    }

    /** Handles resolve view from profile. */
    private resolveViewFromProfile(user: any, profile: any): ResolvedProfileView {
        return {
            displayName: this.resolveDisplayName(user, profile),
            email: this.resolveEmail(user, profile),
            avatarUrl: this.resolveAvatar(user, profile),
        };
    }

    /** Handles resolve display name. */
    private resolveDisplayName(user: any, profile: any): string {
        return this.firstNonEmptyString(
            profile?.displayName,
            this.initialDisplayName,
            user?.displayName,
            user?.email?.split('@')[0],
            'Gast',
        );
    }

    /** Handles resolve email. */
    private resolveEmail(user: any, profile: any): string {
        return this.firstNonEmptyString(
            this.extractProfileEmail(profile),
            this.initialEmail,
            user?.email,
            '',
        );
    }

    /** Handles resolve avatar. */
    private resolveAvatar(user: any, profile: any): string | null {
        return (
            this.normalizeAvatarUrl(profile?.avatar) ||
            this.normalizeAvatarUrl(this.initialAvatarUrl) ||
            this.normalizeAvatarUrl(user?.photoURL)
        );
    }

    /** Handles seed view from inputs. */
    private seedViewFromInputs(): void {
        this.applySeededDisplayName(this.initialDisplayName);
        this.applySeededEmail(this.initialEmail);
        this.applySeededAvatar(this.initialAvatarUrl);
    }

    /** Handles apply seeded display name. */
    private applySeededDisplayName(value: string): void {
        const next = value.trim();
        if (next) this.displayName = next;
    }

    /** Handles apply seeded email. */
    private applySeededEmail(value: string): void {
        const next = value.trim();
        if (next) this.email = next;
    }

    /** Handles apply seeded avatar. */
    private applySeededAvatar(value: string | null): void {
        const next = this.normalizeAvatarUrl(value);
        if (next) {
            this.avatarUrl = next;
            this.editAvatarUrl = next;
            this.selectAvatarFromProfile(next);
        }
    }

    /** Handles extract profile email. */
    private extractProfileEmail(profile: Record<string, unknown> | null): string {
        if (!profile) return '';
        for (const key of this.profileEmailKeys) {
            const value = profile[key];
            const email = typeof value === 'string' ? value.trim() : '';
            if (email) return email;
        }
        return '';
    }

    /** Handles first non empty string. */
    private firstNonEmptyString(...values: Array<string | null | undefined>): string {
        for (const value of values) {
            const next = (value ?? '').trim();
            if (next) return next;
        }
        return '';
    }

    /** Handles normalize avatar url. */
    private normalizeAvatarUrl(avatar: string | null | undefined): string | null {
        const trimmed = (avatar ?? '').trim();
        if (!trimmed) return null;
        if (this.isDirectAvatarUrl(trimmed)) return trimmed;
        return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
    }

    /** Handles is direct avatar url. */
    private isDirectAvatarUrl(value: string): boolean {
        return (
            value.startsWith('data:image/') ||
            value.startsWith('http://') ||
            value.startsWith('https://') ||
            value.startsWith('assets/')
        );
    }

    /** Handles create guest view. */
    private createGuestView(): ResolvedProfileView {
        return { displayName: 'Gast', email: '', avatarUrl: null };
    }

    /** Handles is save allowed. */
    private isSaveAllowed(nextName: string): boolean {
        return !!nextName && !this.isSaving && !this.isEditNameEmpty;
    }

    /** Handles apply optimistic profile and start saving. */
    private applyOptimisticProfileAndStartSaving(nextName: string, nextAvatar: string | null): void {
        this.zone.run(() => {
            this.displayName = nextName;
            this.avatarUrl = nextAvatar;
            this.isEditing = false;
            this.showAvatarPicker = false;
            this.isSaving = true;
        });
    }

    /** Handles persist profile or restore edit. */
    private async persistProfileOrRestoreEdit(nextName: string, avatar: string | null): Promise<void> {
        try {
            await this.userService.updateCurrentUserProfile({
                displayName: nextName,
                ...(avatar ? { avatar } : {}),
            });
        } catch (error) {
            console.error('Profil speichern fehlgeschlagen:', error);
            this.setEditingFlag(true);
        }
    }

    /** Handles set saving flag. */
    private setSavingFlag(value: boolean): void {
        this.zone.run(() => {
            this.isSaving = value;
        });
    }

    /** Handles set editing flag. */
    private setEditingFlag(value: boolean): void {
        this.zone.run(() => {
            this.isEditing = value;
        });
    }

    /** Handles select avatar from existing profile value. */
    private selectAvatarFromProfile(profileAvatar: string | null): void {
        this.uploadedAvatarDataUrl = null;
        this.selectedAvatarId = null;

        const normalizedAvatar = this.normalizeAvatarUrl(profileAvatar);
        if (!normalizedAvatar) return;

        const matchingAvatar = this.avatars.find(
            (avatar) => `assets/pictures/${avatar.path}` === normalizedAvatar,
        );
        if (matchingAvatar) {
            this.selectedAvatarId = matchingAvatar.id;
            return;
        }

        this.selectedAvatarId = 'custom';
        this.uploadedAvatarDataUrl = normalizedAvatar;
    }

    /** Handles resolve avatar for save. */
    private resolveAvatarForSave(): string | null {
        if (this.selectedAvatarId === 'custom') {
            return this.uploadedAvatarDataUrl;
        }

        const selectedAvatar = this.avatars.find(
            (avatar) => avatar.id === this.selectedAvatarId,
        );
        if (selectedAvatar) return `assets/pictures/${selectedAvatar.path}`;
        return this.editAvatarUrl;
    }

    /** Handles resize image to data url. */
    private resizeImageToDataUrl(file: File, maxSize: number, quality: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const img = new Image();

                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                    const width = Math.round(img.width * scale);
                    const height = Math.round(img.height * scale);

                    canvas.width = width;
                    canvas.height = height;

                    const context = canvas.getContext('2d');
                    if (!context) {
                        reject(new Error('Canvas context unavailable'));
                        return;
                    }

                    context.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };

                img.onerror = () => reject(new Error('Invalid image file'));
                img.src = reader.result as string;
            };

            reader.onerror = () => reject(new Error('File could not be read'));
            reader.readAsDataURL(file);
        });
    }

    /** Handles sync name validation state. */
    private syncNameValidationState(): void {
        this.isEditNameEmpty = this.editDisplayName.trim().length === 0;
    }
}
