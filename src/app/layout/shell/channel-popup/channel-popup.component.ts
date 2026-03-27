import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-channel-popup',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './channel-popup.component.html',
    styleUrl: './channel-popup.component.scss',
})
export class ChannelPopupComponent implements OnChanges {
    @Input() channelName = 'Entwicklerteam';
    @Input() left = 24;
    @Input() top = 100;
    @Input() description =
        'Dieser Channel ist für alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.';
    @Input() createdBy = 'Unbekannt';
    @Output() close = new EventEmitter<void>();
    @Output() channelNameChange = new EventEmitter<string>();
    @Output() descriptionChange = new EventEmitter<string>();
    @Output() leaveChannel = new EventEmitter<void>();
    currentChannelName = this.channelName;
    editableChannelName = this.channelName;
    isEditingChannelName = false;
    currentDescription = this.description;
    editableDescription = this.description;
    isEditingDescription = false;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channelName']) {
            this.currentChannelName = this.channelName;
            if (!this.isEditingChannelName) {
                this.editableChannelName = this.channelName;
            }
        }

        if (changes['description']) {
            this.currentDescription = this.description;
            if (!this.isEditingDescription) {
                this.editableDescription = this.description;
            }
        }
    }

    onClose(): void {
        this.close.emit();
    }

    onToggleChannelNameEdit(): void {
        if (this.isEditingChannelName) {
            const nextChannelName = this.editableChannelName.trim();
            if (nextChannelName) {
                this.currentChannelName = nextChannelName;
                this.channelNameChange.emit(nextChannelName);
            }
            this.editableChannelName = this.currentChannelName;
            this.isEditingChannelName = false;
            return;
        }

        this.editableChannelName = this.currentChannelName;
        this.isEditingChannelName = true;
    }

    onToggleDescriptionEdit(): void {
        if (this.isEditingDescription) {
            const nextDescription = this.editableDescription.trim();
            if (nextDescription) {
                this.currentDescription = nextDescription;
                this.descriptionChange.emit(nextDescription);
            }
            this.editableDescription = this.currentDescription;
            this.isEditingDescription = false;
            return;
        }

        this.editableDescription = '';
        this.isEditingDescription = true;
    }

    onLeaveChannelClick(): void {
        this.leaveChannel.emit();
    }
}
