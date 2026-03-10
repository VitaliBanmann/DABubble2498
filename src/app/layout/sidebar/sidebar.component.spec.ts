import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { UnreadStateService } from '../../services/unread-state.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
  authReady$ = of(true);
  currentUser$ = of(null);

  getCurrentUser() {
    return null;
  }
}

class ChannelServiceMock {
  getAllChannels() {
    return of([]);
  }
}

class UserServiceMock {
  getAllUsersRealtime() {
    return of([]);
  }
}

class UnreadStateServiceMock {
  observeUnreadState() {
    return of([]);
  }
}

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        { provide: AuthService, useClass: AuthServiceMock },
        { provide: ChannelService, useClass: ChannelServiceMock },
        { provide: UnreadStateService, useClass: UnreadStateServiceMock },
        { provide: UserService, useClass: UserServiceMock },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
