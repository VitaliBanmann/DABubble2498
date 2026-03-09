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
    isSaving = false;

    private readonly subscription = new Subscription();
    private readonly profileEmailKeys = ['email', 'mail', 'emailAddress', 'eMail'] as const;

    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly zone: NgZone,
    ) {}

    ngOnInit(): void {
        this.seedViewFromInputs();
        this.subscribeToProfileUpdates();
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    requestClose(): void {
        this.close.emit();
    }

    enterEditMode(): void {
        this.isEditing = true;
        this.editDisplayName = this.displayName;
    }

    exitEditMode(): void {
        this.isEditing = false;
    }

    async saveDisplayNameEdit(): Promise<void> {
        const nextName = this.editDisplayName.trim();
        if (!this.isSaveAllowed(nextName)) return;
        this.applyOptimisticNameAndStartSaving(nextName);
        await this.persistDisplayNameOrRestoreEdit(nextName);
        this.setSavingFlag(false);
    }

    updateEditNameDraft(value: string): void {
        this.editDisplayName = value;
    }

    get initials(): string {
        const name = this.displayName.trim();
        if (!name) {
            return 'G';
        }

        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }

        return parts[0][0].toUpperCase();
    }

    private subscribeToProfileUpdates(): void {
        const stream$ = this.authService.currentUser$.pipe(
            switchMap((user) => this.buildViewStreamForUser(user)),
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
    }

    private resolveViewFromProfile(user: any, profile: any): ResolvedProfileView {
        return {
            displayName: this.resolveDisplayName(user, profile),
            email: this.resolveEmail(user, profile),
            avatarUrl: this.resolveAvatar(user, profile),
        };
    }

    private resolveDisplayName(user: any, profile: any): string {
        return this.firstNonEmptyString(
            profile?.displayName,
            this.initialDisplayName,
            user?.displayName,
            user?.email?.split('@')[0],
            'Gast',
        );
    }

    private resolveEmail(user: any, profile: any): string {
        return this.firstNonEmptyString(
            this.extractProfileEmail(profile),
            this.initialEmail,
            user?.email,
            '',
        );
    }

    private resolveAvatar(user: any, profile: any): string | null {
        return (
            this.normalizeAvatarUrl(profile?.avatar) ||
            this.normalizeAvatarUrl(this.initialAvatarUrl) ||
            this.normalizeAvatarUrl(user?.photoURL)
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
        const next = this.normalizeAvatarUrl(value);
        if (next) this.avatarUrl = next;
    }

    private extractProfileEmail(profile: Record<string, unknown> | null): string {
        if (!profile) return '';
        for (const key of this.profileEmailKeys) {
            const value = profile[key];
            const email = typeof value === 'string' ? value.trim() : '';
            if (email) return email;
        }
        return '';
    }

    private firstNonEmptyString(...values: Array<string | null | undefined>): string {
        for (const value of values) {
            const next = (value ?? '').trim();
            if (next) return next;
        }
        return '';
    }

    private normalizeAvatarUrl(avatar: string | null | undefined): string | null {
        const trimmed = (avatar ?? '').trim();
        if (!trimmed) return null;
        if (this.isDirectAvatarUrl(trimmed)) return trimmed;
        return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
    }

    private isDirectAvatarUrl(value: string): boolean {
        return (
            value.startsWith('data:image/') ||
            value.startsWith('http://') ||
            value.startsWith('https://') ||
            value.startsWith('assets/')
        );
    }

    private createGuestView(): ResolvedProfileView {
        return { displayName: 'Gast', email: '', avatarUrl: null };
    }

    private isSaveAllowed(nextName: string): boolean {
        return !!nextName && !this.isSaving;
    }

    private applyOptimisticNameAndStartSaving(nextName: string): void {
        this.zone.run(() => {
            this.displayName = nextName;
            this.isEditing = false;
            this.isSaving = true;
        });
    }

    private async persistDisplayNameOrRestoreEdit(nextName: string): Promise<void> {
        try {
            await this.userService.updateCurrentUserProfile({ displayName: nextName });
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
}
