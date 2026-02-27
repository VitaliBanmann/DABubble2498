import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';

interface AvatarOption {
  id: string;
  name: string;
  path: string;
}

@Component({
  selector: 'app-avatar-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './avatar-select.component.html',
  styleUrl: './avatar-select.component.scss'
})
export class AvatarSelectComponent implements OnInit {
  selectedAvatarId: string | null = null;
  isLoading = false;
  userName = 'Gast';
  uploadedAvatarDataUrl: string | null = null;
  uploadError = '';

  avatars: AvatarOption[] = [
    { id: 'm1', name: 'Mann 1', path: 'profil_m1.svg' },
    { id: 'm2', name: 'Mann 2', path: 'profil_m2.svg' },
    { id: 'm3', name: 'Mann 3', path: 'profil_m3.svg' },
    { id: 'w1', name: 'Frau 1', path: 'profil_w1.svg' },
    { id: 'w2', name: 'Frau 2', path: 'profil_w2.svg' },
  ];

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUser();

    if (currentUser?.isAnonymous) {
      this.userName = 'Gast';
    } else if (currentUser?.displayName) {
      this.userName = currentUser.displayName;
    } else if (currentUser?.email) {
      this.userName = currentUser.email.split('@')[0];
    }

    if (currentUser?.uid) {
      this.userService.getUser(currentUser.uid).pipe(take(1)).subscribe({
        next: (profile) => {
          if (profile?.displayName) {
            this.userName = profile.displayName;
          }

          if (profile?.avatar) {
            const matchingAvatar = this.avatars.find((avatar) => `assets/pictures/${avatar.path}` === profile.avatar);

            if (matchingAvatar) {
              this.selectedAvatarId = matchingAvatar.id;
            } else {
              this.selectedAvatarId = 'custom';
              this.uploadedAvatarDataUrl = profile.avatar;
            }
          }
        }
      });
    }

    if (!this.selectedAvatarId) {
      this.selectAvatar('m1');
    }
  }

  get currentAvatarPath(): string {
    if (this.selectedAvatarId === 'custom' && this.uploadedAvatarDataUrl) {
      return this.uploadedAvatarDataUrl;
    }

    const avatar = this.avatars.find((a) => a.id === this.selectedAvatarId);
    return avatar ? `assets/pictures/${avatar.path}` : 'assets/pictures/profil_m1.svg';
  }

  selectAvatar(avatarId: string): void {
    this.selectedAvatarId = avatarId;
    if (avatarId !== 'custom') {
      this.uploadError = '';
    }
  }

  async handleFileUpload(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
      this.uploadError = '';

      try {
        const processedImage = await this.resizeImageToDataUrl(file, 512, 0.82);
        this.uploadedAvatarDataUrl = processedImage;
        this.selectedAvatarId = 'custom';
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Image upload failed:', error);
        this.uploadError = 'Das Bild konnte nicht verarbeitet werden. Bitte versuche eine andere Datei.';
      }
    }

    target.value = '';
  }

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

  private resolveAvatarForSave(): string | null {
    if (this.selectedAvatarId === 'custom') {
      return this.uploadedAvatarDataUrl;
    }

    const selectedAvatar = this.avatars.find((avatar) => avatar.id === this.selectedAvatarId);
    return selectedAvatar ? `assets/pictures/${selectedAvatar.path}` : null;
  }

  private resolveDisplayNameForSave(): string {
    const trimmedName = this.userName.trim();

    if (trimmedName) {
      return trimmedName;
    }

    const currentUser = this.authService.getCurrentUser();
    if (currentUser?.isAnonymous) {
      return 'Gast';
    }

    return currentUser?.displayName?.trim() || 'Gast';
  }

  onBack(): void {
    void this.router.navigateByUrl('/');
  }

  onUploadClick(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  async onContinue(): Promise<void> {
    const avatarToSave = this.resolveAvatarForSave();
    if (!avatarToSave) {
      return;
    }

    this.isLoading = true;
    this.uploadError = '';

    try {
      const currentUser = this.authService.getCurrentUser();
      if (currentUser) {
        await this.userService.updateCurrentUserProfile({
          avatar: avatarToSave,
          displayName: this.resolveDisplayNameForSave(),
        });
      }

      void this.router.navigateByUrl('/home');
    } catch (error) {
      console.error('Profile save failed, continuing to home:', error);
      void this.router.navigateByUrl('/home');
    } finally {
      this.isLoading = false;
    }
  }
}
