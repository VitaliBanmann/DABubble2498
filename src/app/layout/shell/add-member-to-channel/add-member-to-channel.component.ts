import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface AddMemberPopupUser {
    id: string;
    displayName: string;
    avatar: string;
    isOnline: boolean;
}

@Component({
    selector: 'app-add-member-to-channel',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './add-member-to-channel.component.html',
    styleUrl: './add-member-to-channel.component.scss',
})
export class AddMemberToChannelComponent {
    @Input() channelName = 'Entwicklerteam';
    @Input() availableUsers: AddMemberPopupUser[] = [];
    @Output() close = new EventEmitter<void>();
    @Output() addMember = new EventEmitter<string>();
    searchValue = '';
    visibleSuggestions: AddMemberPopupUser[] = [];
    showSuggestions = false;
    selectedUserId: string | null = null;

    onClose(): void {
        this.close.emit();
    }

    onSearchInput(): void {
        this.selectedUserId = null;
        const raw = this.searchValue.trimStart();
        if (!raw.startsWith('@')) {
            this.visibleSuggestions = [];
            this.showSuggestions = false;
            return;
        }

        const token = raw.slice(1).trim().toLowerCase();
        this.visibleSuggestions = this.availableUsers
            .filter((user) =>
                user.displayName.toLowerCase().includes(token),
            )
            .slice(0, 8);
        this.showSuggestions = this.visibleSuggestions.length > 0;
    }

    onSuggestionSelect(user: AddMemberPopupUser): void {
        this.selectedUserId = user.id;
        this.searchValue = `@${user.displayName}`;
        this.showSuggestions = false;
    }

    onSubmitClick(): void {
        const selected = this.resolveSelectedUserId();
        if (!selected) {
            return;
        }

        this.addMember.emit(selected);
    }

    private resolveSelectedUserId(): string | null {
        if (this.selectedUserId) {
            return this.selectedUserId;
        }

        const token = this.searchValue.trim().replace(/^@/, '').toLowerCase();
        if (!token) {
            return null;
        }

        const directMatch = this.availableUsers.find(
            (user) => user.displayName.trim().toLowerCase() === token,
        );
        return directMatch?.id ?? null;
    }
}
