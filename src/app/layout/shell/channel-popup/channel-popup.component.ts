import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-channel-popup',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './channel-popup.component.html',
    styleUrl: './channel-popup.component.scss',
})
export class ChannelPopupComponent {
    @Input() channelName = 'Entwicklerteam';
    @Input() left = 24;
    @Input() top = 100;
    @Input() description =
        'Dieser Channel ist für alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.';
    @Input() createdBy = 'Noah Braun';
    @Output() close = new EventEmitter<void>();

    onClose(): void {
        this.close.emit();
    }
}
