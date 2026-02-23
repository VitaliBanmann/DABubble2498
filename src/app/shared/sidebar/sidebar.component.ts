import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelService, Channel } from '../../services/channel.service';
import { UserService, User } from '../../services/user.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit {
  channels: Channel[] = [];
  directMessages: User[] = [];
  selectedChannelId: string | null = null;
  isLoadingChannels = false;
  isLoadingDMs = false;

  constructor(
    private readonly channelService: ChannelService,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.loadChannels();
    this.loadDirectMessages();
  }

  private loadChannels(): void {
    this.isLoadingChannels = true;
    this.channelService.getAllChannels().subscribe({
      next: (channels: Channel[]) => {
        this.channels = channels;
        this.isLoadingChannels = false;
      },
      error: (error: any) => {
        console.error('Error loading channels:', error);
        this.isLoadingChannels = false;
      }
    });
  }

  private loadDirectMessages(): void {
    this.isLoadingDMs = true;
    this.userService.getAllUsers().subscribe({
      next: (users: User[]) => {
        this.directMessages = users;
        this.isLoadingDMs = false;
      },
      error: (error: any) => {
        console.error('Error loading users:', error);
        this.isLoadingDMs = false;
      }
    });
  }

  selectChannel(channelId: string): void {
    this.selectedChannelId = channelId;
  }

  selectDirectMessage(userId: string): void {
    this.selectedChannelId = `dm-${userId}`;
  }
}
