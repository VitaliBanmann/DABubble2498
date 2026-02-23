import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ChatHeaderComponent } from '../chat-header/chat-header.component';
import { ChatViewComponent } from '../chat-view/chat-view.component';
import { ThreadPanelComponent } from '../thread-panel/thread-panel.component';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { take } from 'rxjs';

@Component({
  selector: 'app-chat-layout',
  standalone: true,
  imports: [
    CommonModule,
    SidebarComponent,
    ChatHeaderComponent,
    ChatViewComponent,
    ThreadPanelComponent
  ],
  templateUrl: './chat-layout.component.html',
  styleUrl: './chat-layout.component.scss'
})
export class ChatLayoutComponent implements OnInit {
  currentUserName = 'Gast';
  currentUserAvatar = 'assets/pictures/profil_m1.svg';
  selectedChannelId: string | null = null;
  selectedThreadId: string | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUser();

    if (currentUser?.isAnonymous) {
      this.currentUserName = 'Gast';
    } else if (currentUser?.displayName) {
      this.currentUserName = currentUser.displayName;
    } else if (currentUser?.email) {
      this.currentUserName = currentUser.email.split('@')[0];
    }

    if (!currentUser?.uid) {
      return;
    }

    this.userService.getUser(currentUser.uid).pipe(take(1)).subscribe({
      next: (profile) => {
        if (profile?.displayName) {
          this.currentUserName = profile.displayName;
        }

        if (profile?.avatar) {
          this.currentUserAvatar = profile.avatar;
        }
      }
    });
  }

  onChannelSelected(channelId: string): void {
    this.selectedChannelId = channelId;
    this.selectedThreadId = null;
  }

  onThreadOpened(threadId: string): void {
    this.selectedThreadId = threadId;
  }
}
