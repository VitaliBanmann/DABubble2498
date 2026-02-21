import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService, Message } from '../../services/message.service';

@Component({
  selector: 'app-thread-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './thread-panel.component.html',
  styleUrl: './thread-panel.component.scss'
})
export class ThreadPanelComponent implements OnInit {
  @Input() selectedThreadId: string | null = null;

  threadMessages: Message[] = [];
  threadTitle = '';
  newReply = '';
  isLoadingThread = false;
  isSending = false;
  isThreadOpen = false;

  constructor(private readonly messageService: MessageService) {}

  ngOnInit(): void {
    if (this.selectedThreadId) {
      this.isThreadOpen = true;
      this.loadThreadMessages();
    }
  }

  private loadThreadMessages(): void {
    if (!this.selectedThreadId) return;

    this.isLoadingThread = true;
    // TODO: Implement thread message loading
    this.isLoadingThread = false;
  }

  async sendReply(): Promise<void> {
    if (!this.newReply.trim() || !this.selectedThreadId) {
      return;
    }

    this.isSending = true;
    const replyText = this.newReply;
    this.newReply = '';

    // TODO: Implement reply sending
    setTimeout(() => {
      this.isSending = false;
      this.loadThreadMessages();
    }, 500);
  }

  closeThread(): void {
    this.isThreadOpen = false;
    this.selectedThreadId = null;
  }

  handleEnterKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.sendReply();
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
