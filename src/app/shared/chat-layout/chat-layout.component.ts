import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ChatHeaderComponent } from '../chat-header/chat-header.component';
import { ChatViewComponent } from '../chat-view/chat-view.component';
import { ThreadPanelComponent } from '../thread-panel/thread-panel.component';
import { AuthService } from '../../services/auth.service';

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
  currentUserName = '';
  selectedChannelId: string | null = null;
  selectedThreadId: string | null = null;

  constructor(private readonly authService: AuthService) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUser();
    this.currentUserName = currentUser?.displayName ?? 'User';
  }

  onChannelSelected(channelId: string): void {
    this.selectedChannelId = channelId;
    this.selectedThreadId = null;
  }

  onThreadOpened(threadId: string): void {
    this.selectedThreadId = threadId;
  }
}
