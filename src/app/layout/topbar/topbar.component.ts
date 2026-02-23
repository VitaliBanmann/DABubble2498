import { Component } from '@angular/core';
import { UiStateService } from '../../services/ui-state.service';

@Component({
    selector: 'app-topbar',
    standalone: true,
    templateUrl: './topbar.component.html',
    styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
    constructor(public readonly ui: UiStateService) {}
}
