import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Channel } from '../../services/channel.service';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.scss'
})
export class ChatHeaderComponent {
  @Input() currentChannel: Channel | null = null;
  @Input() currentUserName: string = '';
  @Input() currentUserAvatar: string = 'assets/pictures/profil_m1.svg';
  @Output() searchChanged = new EventEmitter<string>();

  searchQuery = '';

  onSearchChange(): void {
    this.searchChanged.emit(this.searchQuery);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchChanged.emit('');
  }
}
