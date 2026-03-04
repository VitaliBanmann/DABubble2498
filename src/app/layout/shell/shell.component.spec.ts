import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ShellComponent } from './shell.component';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { PresenceService } from '../../services/presence.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
  currentUser$ = of(null);
}

class UserServiceMock {
  getAllUsers() {
    return of([]);
  }

  getUserRealtime() {
    return of(null);
  }
}

class ChannelServiceMock {
  getAllChannels() {
    return of([]);
  }
}

class MessageServiceMock {
  getAllMessages() {
    return of([]);
  }
}

class PresenceServiceMock {
  setStatus(): Promise<void> {
    return Promise.resolve();
  }
}

describe('ShellComponent', () => {
  let component: ShellComponent;
  let fixture: ComponentFixture<ShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        { provide: AuthService, useClass: AuthServiceMock },
        { provide: UserService, useClass: UserServiceMock },
        { provide: ChannelService, useClass: ChannelServiceMock },
        { provide: MessageService, useClass: MessageServiceMock },
        { provide: PresenceService, useClass: PresenceServiceMock },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(ShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
