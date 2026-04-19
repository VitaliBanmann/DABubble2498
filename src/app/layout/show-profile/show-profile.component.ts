import {
    Component,
    EventEmitter,
    Input,
    NgZone,
    OnDestroy,
    OnInit,
    Output,
} from '@angular/core';
import {
    Subscription,
    catchError,
    combineLatest,
    filter,
    map,
    of,
    startWith,
    switchMap,
} from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import {
    extractProfileEmail,
    firstNonEmptyString,
    getProfileInitials,
    normalizeAvatarUrl,
    resizeImageToDataUrl,
} from './show-profile.utils';

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
    @Input() isGuestUser = false;
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

    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly zone: NgZone,
    ) {}

    ngOnInit(): void {
        this.seedViewFromInputs();
        this.syncGuestStateFromCurrentUser();
        this.subscribeToProfileUpdates();
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    requestClose(): void {
        this.close.emit();
    }

    enterEditMode(): void {
        if (this.isGuestUser) return;

        this.isEditing = true;
        this.editDisplayName = this.displayName;
        this.syncNameValidationState();
        this.editAvatarUrl = this.avatarUrl;
        this.selectAvatarFromProfile(this.avatarUrl);
        this.showAvatarPicker = false;
        this.uploadError = '';
    }

    exitEditMode(): void {
        this.isEditing = false;
        this.showAvatarPicker = false;
    }

    async saveProfileEdit(): Promise<void> {
        if (this.isGuestUser) return;

        const nextName = this.editDisplayName.trim();
        if (!this.isSaveAllowed(nextName)) return;
        const nextAvatar = this.resolveAvatarForSave();
        this.applyOptimisticProfileAndStartSaving(nextName, nextAvatar);
        await this.persistProfileOrRestoreEdit(nextName, nextAvatar);
        this.setSavingFlag(false);
    }

    updateEditNameDraft(value: string): void {
        this.editDisplayName = value;
        this.syncNameValidationState();
    }

    toggleAvatarPicker(): void {
        if (this.isGuestUser || !this.isEditing || this.isSaving) return;
        this.showAvatarPicker = !this.showAvatarPicker;
    }

    selectAvatar(avatarId: string): void {
        if (this.isGuestUser || !this.isEditing || this.isSaving) return;

        this.selectedAvatarId = avatarId;
        this.uploadError = '';

        if (avatarId === 'custom') {
            this.editAvatarUrl = this.uploadedAvatarDataUrl;
            return;
        }

        const selected = this.avatars.find((avatar) => avatar.id === avatarId);
        this.editAvatarUrl = selected ? `assets/pictures/${selected.path}` : null;
    }

    onUploadClick(fileInput: HTMLInputElement): void {
        if (this.isGuestUser || !this.isEditing || this.isSaving) return;
        fileInput.click();
    }

    async handleFileUpload(event: Event): Promise<void> {
        if (this.isGuestUser || !this.isEditing || this.isSaving) return;

        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
            target.value = '';
            return;
        }

        this.uploadError = '';

        try {
            const dataUrl = await resizeImageToDataUrl(file, 512, 0.82);
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
        const name = this.isEditing ? this.editDisplayName : this.displayName;
        return getProfileInitials(name);
    }

    private subscribeToProfileUpdates(): void {
        const stream$ = combineLatest([
            this.authService.authReady$,
            this.authService.currentUser$,
        ]).pipe(
            filter(([ready]) => ready),
            switchMap(([, user]) => {
                this.syncGuestState(user);
                return this.buildViewStreamForUser(user);
            }),
        );
        this.subscription.add(stream$.subscribe((view) => this.applyResolvedView(view)));
    }

    private buildViewStreamForUser(user: any) {
        if (!user || user.isAnonymous) return of(this.createGuestView());
        return this.userService.getUserProfileRealtime(user.uid, user.email ?? '').pipe(
            startWith(null),
            catchError(() => of(null)),
            map((profile) => this.resolveViewFromProfile(user, profile)),
        );
    }

    private applyResolvedView(view: ResolvedProfileView): void {
        this.displayName = view.displayName;
        this.email = view.email;
        this.avatarUrl = view.avatarUrl;

        if (this.isGuestUser && this.isEditing) {
            this.exitEditMode();
        }

        if (!this.isEditing) {
            this.editAvatarUrl = view.avatarUrl;
            this.selectAvatarFromProfile(view.avatarUrl);
        }
    }

    private resolveViewFromProfile(user: any, profile: any): ResolvedProfileView {
        return {
            displayName: this.resolveDisplayName(user, profile),
            email: this.resolveEmail(user, profile),
            avatarUrl: this.resolveAvatar(user, profile),
        };
    }

    private resolveDisplayName(user: any, profile: any): string {
        return firstNonEmptyString(
            profile?.displayName,
            this.initialDisplayName,
            user?.displayName,
            user?.email?.split('@')[0],
            'Gast',
        );
    }

    private resolveEmail(user: any, profile: any): string {
        return firstNonEmptyString(
            extractProfileEmail(profile),
            this.initialEmail,
            user?.email,
            '',
        );
    }

    private resolveAvatar(user: any, profile: any): string | null {
        return (
            normalizeAvatarUrl(profile?.avatar)
            || normalizeAvatarUrl(this.initialAvatarUrl)
            || normalizeAvatarUrl(user?.photoURL)
        );
    }

    private seedViewFromInputs(): void {
        this.applySeededDisplayName(this.initialDisplayName);
        this.applySeededEmail(this.initialEmail);
        this.applySeededAvatar(this.initialAvatarUrl);
    }

    private applySeededDisplayName(value: string): void {
        const next = value.trim();
        if (next) this.displayName = next;
    }

    private applySeededEmail(value: string): void {
        const next = value.trim();
        if (next) this.email = next;
    }

    private applySeededAvatar(value: string | null): void {
        const next = normalizeAvatarUrl(value);
        if (next) {
            this.avatarUrl = next;
            this.editAvatarUrl = next;
            this.selectAvatarFromProfile(next);
        }
    }

    private createGuestView(): ResolvedProfileView {
        return { displayName: 'Gast', email: '', avatarUrl: null };
    }

    private isSaveAllowed(nextName: string): boolean {
        return !!nextName && !this.isGuestUser && !this.isSaving && !this.isEditNameEmpty;
    }

    private applyOptimisticProfileAndStartSaving(nextName: string, nextAvatar: string | null): void {
        this.zone.run(() => {
            this.displayName = nextName;
            this.avatarUrl = nextAvatar;
            this.isEditing = false;
            this.showAvatarPicker = false;
            this.isSaving = true;
        });
    }

    private async persistProfileOrRestoreEdit(nextName: string, avatar: string | null): Promise<void> {
        if (this.isGuestUser) return;

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

    private setSavingFlag(value: boolean): void {
        this.zone.run(() => {
            this.isSaving = value;
        });
    }

    private setEditingFlag(value: boolean): void {
        this.zone.run(() => {
            this.isEditing = value;
        });
    }

    private selectAvatarFromProfile(profileAvatar: string | null): void {
        this.uploadedAvatarDataUrl = null;
        this.selectedAvatarId = null;

        const normalizedAvatar = normalizeAvatarUrl(profileAvatar);
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

    private syncNameValidationState(): void {
        this.isEditNameEmpty = this.editDisplayName.trim().length === 0;
    }

    private syncGuestStateFromCurrentUser(): void {
        const currentUser = this.authService.getCurrentUser();
        if (currentUser) {
            this.isGuestUser = currentUser.isAnonymous;
        }
    }

    private syncGuestState(user: { isAnonymous?: boolean } | null): void {
        this.isGuestUser = !user || !!user.isAnonymous;
    }
}
