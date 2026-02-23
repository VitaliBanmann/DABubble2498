import { Component, Input, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService, Message } from '../../services/message.service';
import { ChannelService, Channel } from '../../services/channel.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.scss'
})
export class ChatViewComponent implements OnInit, AfterViewChecked {
  @Input() selectedChannelId: string | null = null;
  @ViewChild('messageContainer', { static: false }) messageContainer!: ElementRef;

  messages: Message[] = [];
  currentChannel: Channel | null = null;
  currentUserId: string | null = null;
  newMessage = '';
  isLoadingMessages = false;
  isSending = false;

  constructor(
    private readonly messageService: MessageService,
    private readonly channelService: ChannelService,
    private readonly authService: AuthService
  ) {
    const currentUser = this.authService.getCurrentUser();
    this.currentUserId = currentUser?.uid ?? null;
  }

  ngOnInit(): void {
    if (this.selectedChannelId) {
      this.loadChannel();
      this.loadMessages();
    }
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  private loadChannel(): void {
    if (!this.selectedChannelId || this.selectedChannelId.startsWith('dm-')) {
      return;
    }

    this.channelService.getChannel(this.selectedChannelId).subscribe({
      next: (channel: Channel | null) => {
        this.currentChannel = channel;
      },
      error: (error: any) => console.error('Error loading channel:', error)
    });
  }

  private loadMessages(): void {
    if (!this.selectedChannelId) return;

    this.isLoadingMessages = true;
    // TODO: Implement message loading per channel
    this.isLoadingMessages = false;
  }

  async sendMessage(): Promise<void> {
    if (!this.newMessage.trim() || !this.currentUserId) {
      return;
    }

    this.isSending = true;
    const messageText = this.newMessage;
    this.newMessage = '';

    const message: Message = {
      text: messageText,
      senderId: this.currentUserId,
      channelId: this.selectedChannelId || '',
      timestamp: new Date(),
      read: false
    };

    this.messageService.sendMessage(message).subscribe({
      next: () => {
        this.isSending = false;
        this.loadMessages();
      },
      error: (error: any) => {
        console.error('Error sending message:', error);
        this.isSending = false;
      }
    });
  }

  private scrollToBottom(): void {
    if (this.messageContainer) {
      this.messageContainer.nativeElement.scrollTop = this.messageContainer.nativeElement.scrollHeight;
    }
  }

  handleEnterKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.sendMessage();
    }
  }

  getMessageTime(timestamp: any): string {
    if (!timestamp) return 'Jetzt';
    try {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp.seconds * 1000);
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Jetzt';
    }
  }
}
