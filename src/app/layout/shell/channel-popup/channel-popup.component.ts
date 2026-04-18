import { CommonModule } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
} from '@angular/core';
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
    @Input() description =
        'Dieser Channel ist für alles rund um das Entwickeln vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.';
    @Input() createdBy = 'Unbekannt';
    @Input() errorMessage = '';
    @Input() canDeleteChannel = false;

    @Output() close = new EventEmitter<void>();
    @Output() channelNameChange = new EventEmitter<string>();
    @Output() descriptionChange = new EventEmitter<string>();
    @Output() leaveChannel = new EventEmitter<void>();
    @Output() deleteChannel = new EventEmitter<void>();

    currentChannelName = this.channelName;
    editableChannelName = this.channelName;
    isEditingChannelName = false;

    currentDescription = this.description;
    editableDescription = this.description;
    isEditingDescription = false;

    /** Handles ng on changes. */
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

    /** Handles on close. */
    onClose(): void {
        this.close.emit();
    }

    /** Handles on toggle channel name edit. */
    onToggleChannelNameEdit(): void {
        if (this.isEditingChannelName) {
            const nextChannelName = this.editableChannelName.trim();

            if (!nextChannelName) {
                this.editableChannelName = this.currentChannelName;
                this.isEditingChannelName = false;
                return;
            }

            this.channelNameChange.emit(nextChannelName);
            this.editableChannelName = this.currentChannelName;
            this.isEditingChannelName = false;
            return;
        }

        this.editableChannelName = this.currentChannelName;
        this.isEditingChannelName = true;
    }

    /** Handles on toggle description edit. */
    onToggleDescriptionEdit(): void {
        if (this.isEditingDescription) {
            const nextDescription = this.editableDescription.trim();

            if (!nextDescription) {
                this.editableDescription = this.currentDescription;
                this.isEditingDescription = false;
                return;
            }

            this.descriptionChange.emit(nextDescription);
            this.editableDescription = this.currentDescription;
            this.isEditingDescription = false;
            return;
        }

        this.editableDescription = this.currentDescription;
        this.isEditingDescription = true;
    }

    /** Handles on leave channel click. */
    onLeaveChannelClick(): void {
        this.leaveChannel.emit();
    }

    /** Handles on delete channel click. */
    onDeleteChannelClick(): void {
        this.deleteChannel.emit();
    }
}
