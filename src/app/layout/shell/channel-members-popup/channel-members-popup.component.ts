import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface ChannelMembersPopupEntry {
    id: string;
    displayName: string;
    avatar: string;
    isSelf: boolean;
    isOnline: boolean;
}

@Component({
    selector: 'app-channel-members-popup',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './channel-members-popup.component.html',
    styleUrl: './channel-members-popup.component.scss',
})
export class ChannelMembersPopupComponent {
    @Input() members: ChannelMembersPopupEntry[] = [];
    @Input() left = 24;
    @Input() top = 120;
    @Output() close = new EventEmitter<void>();
    @Output() addMember = new EventEmitter<void>();

    onClose(): void {
        this.close.emit();
    }

    onAddMemberClick(): void {
        this.addMember.emit();
    }
}
