import {
    Component,
    EventEmitter,
    Input,
    NgZone,
    OnDestroy,
    OnInit,
    Output,
} from '@angular/core';
import { Subscription, catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';

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

    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly zone: NgZone,
    ) {}

    ngOnInit(): void {
        this.applyInitialValues();

        this.subscription.add(
            this.authService.currentUser$
                .pipe(
                    switchMap((user) => {
                        if (!user || user.isAnonymous) {
                            this.displayName = 'Gast';
                            this.email = '';
                            this.avatarUrl = null;
                            return of(null);
                        }

                        this.displayName =
                            user.displayName?.trim() ||
                            user.email?.split('@')[0] ||
                            'Gast';
                        this.email = user.email ?? '';
                        this.avatarUrl = this.resolveAvatarUrl(user.photoURL ?? '');

                        return this.userService
                            .getUserProfileRealtime(user.uid, user.email ?? '')
                            .pipe(
                            catchError(() => of(null)),
                            );
                    }),
                )
                .subscribe((profile) => {
                    if (!profile) {
                        return;
                    }

                    if (profile.displayName?.trim()) {
                        this.displayName = profile.displayName.trim();
                    }

                    const resolvedEmail = this.resolveProfileEmail(profile);
                    if (resolvedEmail) {
                        this.email = resolvedEmail;
                    }

                    if (profile.avatar) {
                        this.avatarUrl = this.resolveAvatarUrl(profile.avatar);
                    }
                }),
        );
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    onClose(): void {
        this.close.emit();
    }

    startEdit(): void {
        this.isEditing = true;
        this.editDisplayName = this.displayName;
    }

    cancelEdit(): void {
        this.isEditing = false;
    }

    async saveEdit(): Promise<void> {
        const nextName = this.editDisplayName.trim();
        if (!nextName || this.isSaving) {
            return;
        }

        // UI sofort zurück zur normalen Ansicht schalten (Saving machen wir im Hintergrund).
        this.zone.run(() => {
            this.displayName = nextName;
            this.isEditing = false;
            this.isSaving = true;
        });

        try {
            await this.userService.updateCurrentUserProfile({
                displayName: nextName,
            });
        } catch (error) {
            console.error('Profil speichern fehlgeschlagen:', error);
            // Optional: zurück in den Bearbeiten-Modus, wenn Speichern fehlschlägt
            this.zone.run(() => {
                this.isEditing = true;
            });
        } finally {
            this.zone.run(() => {
                this.isSaving = false;
            });
        }
    }

    onEditNameInput(value: string): void {
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

    private applyInitialValues(): void {
        const seededName = this.initialDisplayName.trim();
        const seededEmail = this.initialEmail.trim();
        const seededAvatar = this.resolveAvatarUrl(this.initialAvatarUrl ?? '');

        if (seededName) {
            this.displayName = seededName;
        }

        if (seededEmail) {
            this.email = seededEmail;
        }

        if (seededAvatar) {
            this.avatarUrl = seededAvatar;
        }
    }

    private resolveProfileEmail(profile: Record<string, unknown>): string {
        const candidates = [
            profile['email'],
            profile['mail'],
            profile['emailAddress'],
            profile['eMail'],
        ];

        const firstEmail = candidates.find(
            (value) => typeof value === 'string' && value.trim().length > 0,
        );

        return typeof firstEmail === 'string' ? firstEmail.trim() : '';
    }

    private resolveAvatarUrl(avatar: string): string | null {
        const trimmed = avatar.trim();
        if (!trimmed) {
            return null;
        }

        if (
            trimmed.startsWith('data:image/') ||
            trimmed.startsWith('http://') ||
            trimmed.startsWith('https://') ||
            trimmed.startsWith('assets/')
        ) {
            return trimmed;
        }

        return `assets/pictures/${trimmed.replace(/^\/+/, '')}`;
    }
}
