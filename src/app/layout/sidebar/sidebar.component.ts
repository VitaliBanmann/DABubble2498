import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { UserService } from '../../services/user.service';
import { UiStateService } from '../../services/ui-state.service';
import { GlobalSearchService } from '../../services/global-search.service';
import { SidebarComponentBase } from './sidebar.component.base';

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './sidebar.component.html',
    styleUrl: './sidebar.component.scss',
})
export class SidebarComponent
    extends SidebarComponentBase
    implements OnInit, OnDestroy
{
    constructor(
        authService: AuthService,
        channelService: ChannelService,
        userService: UserService,
        router: Router,
        ui: UiStateService,
        globalSearchService: GlobalSearchService,
    ) {
        super(
            authService,
            channelService,
            userService,
            router,
            ui,
            globalSearchService,
        );
    }

    ngOnInit(): void {
        this.initSidebarState();
    }

    ngOnDestroy(): void {
        this.destroySidebarState();
    }

    @HostListener('window:resize')
    onResize(): void {
        this.onWindowResize();
    }
}
