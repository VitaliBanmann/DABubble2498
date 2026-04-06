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
    }

    /** Handles exit edit mode. */
    exitEditMode(): void {
        this.isEditing = false;
    }

    /** Handles save display name edit. */
    async saveDisplayNameEdit(): Promise<void> {
        const nextName = this.editDisplayName.trim();
        if (!this.isSaveAllowed(nextName)) return;
        this.applyOptimisticNameAndStartSaving(nextName);
        await this.persistDisplayNameOrRestoreEdit(nextName);
        this.setSavingFlag(false);
    }

    /** Handles update edit name draft. */
    updateEditNameDraft(value: string): void {
        this.editDisplayName = value;
    }

    /** Returns initials. */
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
        if (next) this.avatarUrl = next;
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
        return !!nextName && !this.isSaving;
    }

    /** Handles apply optimistic name and start saving. */
    private applyOptimisticNameAndStartSaving(nextName: string): void {
        this.zone.run(() => {
            this.displayName = nextName;
            this.isEditing = false;
            this.isSaving = true;
        });
    }

    /** Handles persist display name or restore edit. */
    private async persistDisplayNameOrRestoreEdit(nextName: string): Promise<void> {
        try {
            await this.userService.updateCurrentUserProfile({ displayName: nextName });
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
}
