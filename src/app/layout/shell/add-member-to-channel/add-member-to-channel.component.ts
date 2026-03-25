import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-add-member-to-channel',
    standalone: true,
    imports: [],
    templateUrl: './add-member-to-channel.component.html',
    styleUrl: './add-member-to-channel.component.scss',
})
export class AddMemberToChannelComponent {
    @Input() channelName = 'Entwicklerteam';
    @Output() close = new EventEmitter<void>();

    onClose(): void {
        this.close.emit();
    }
}
