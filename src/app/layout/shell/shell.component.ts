import { Component, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { UiStateService } from '../../services/ui-state.service';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-shell',
    standalone: true,
    imports: [
        CommonModule,
        RouterOutlet,
        SidebarComponent,
        TopbarComponent,
        MatIconModule,
    ],
    templateUrl: './shell.component.html',
    styleUrl: './shell.component.scss',
})
export class ShellComponent {
    constructor(public readonly ui: UiStateService) {}

    readonly classes = computed(() => ({
        'sidebar-open': this.ui.isSidebarOpen(),
        'thread-open': this.ui.isThreadOpen(),
    }));
}
