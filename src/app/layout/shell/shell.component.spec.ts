import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShellComponent } from './shell.component';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { MessageService } from '../../services/message.service';
import { PresenceService } from '../../services/presence.service';
import { UnreadStateService } from '../../services/unread-state.service';
import { UserService } from '../../services/user.service';
import {
  AuthServiceMock,
  ChannelServiceMock,
  MessageServiceMock,
  PresenceServiceMock,
  UnreadStateServiceMock,
  UserServiceMock,
} from '../testing/layout-service-mocks';

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
        { provide: UnreadStateService, useClass: UnreadStateServiceMock },
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
