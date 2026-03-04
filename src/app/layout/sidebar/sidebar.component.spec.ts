import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../services/auth.service';
import { ChannelService } from '../../services/channel.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
  currentUser$ = of(null);
}

class ChannelServiceMock {
  getAllChannels() {
    return of([]);
  }
}

class UserServiceMock {
  getAllUsers() {
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
