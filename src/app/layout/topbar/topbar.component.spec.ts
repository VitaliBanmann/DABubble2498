import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { TopbarComponent } from './topbar.component';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { PresenceService } from '../../services/presence.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
  authReady$ = of(true);
  currentUser$ = of(null);

  getCurrentUser() {
    return null;
  }

  logout(): Promise<void> {
    return Promise.resolve();
  }
}

class UserServiceMock {
  getAllUsersRealtime() {
    return of([]);
  }

  getUserProfileRealtime() {
    return of(null);
  }

  searchUsersByToken() {
    return of([]);
  }
}

class ChannelServiceMock {
  searchChannelsByToken() {
    return of([]);
  }
}

class MessageServiceMock {
  searchMessagesByToken() {
    return of([]);
  }
}

class PresenceServiceMock {
  setStatus(): Promise<void> {
    return Promise.resolve();
  }
}

describe('TopbarComponent', () => {
  let component: TopbarComponent;
  let fixture: ComponentFixture<TopbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [
        { provide: AuthService, useClass: AuthServiceMock },
        { provide: UserService, useClass: UserServiceMock },
        { provide: ChannelService, useClass: ChannelServiceMock },
        { provide: MessageService, useClass: MessageServiceMock },
        { provide: PresenceService, useClass: PresenceServiceMock },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(TopbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
