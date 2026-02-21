import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
  userName = 'Frederik Beck';

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
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUser();
    if (currentUser?.displayName) {
      this.userName = currentUser.displayName;
    }
    this.selectAvatar('m1');
  }

  get currentAvatarPath(): string {
    const avatar = this.avatars.find((a) => a.id === this.selectedAvatarId);
    return avatar ? `assets/pictures/${avatar.path}` : 'assets/pictures/profil_m1.svg';
  }

  selectAvatar(avatarId: string): void {
    this.selectedAvatarId = avatarId;
  }

  triggerFileUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => this.handleFileUpload(e);
    input.click();
  }

  private handleFileUpload(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        console.log('File uploaded:', file.name);
        console.log('File size:', file.size);
        // TODO: Implement actual file upload to Firebase Storage
        // For now, we'll use a placeholder
      };
      reader.readAsDataURL(file);
    }
  }

  async onContinue(): Promise<void> {
    if (!this.selectedAvatarId) {
      return;
    }

    this.isLoading = true;
    const selectedAvatar = this.avatars.find((a) => a.id === this.selectedAvatarId);

    if (selectedAvatar) {
      this.userService.updateCurrentUserProfile({
        avatar: `assets/pictures/${selectedAvatar.path}`
      });

      setTimeout(() => {
        this.isLoading = false;
        this.router.navigateByUrl('/home');
      }, 500);
    }
  }
}
