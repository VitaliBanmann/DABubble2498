import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ShowProfileComponent } from './show-profile.component';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
    currentUser$ = of(null);
}

class UserServiceMock {
    getUserRealtime() {
        return of(null);
    }
}

describe('ShowProfileComponent', () => {
    let component: ShowProfileComponent;
    let fixture: ComponentFixture<ShowProfileComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ShowProfileComponent],
            providers: [
                { provide: AuthService, useClass: AuthServiceMock },
                { provide: UserService, useClass: UserServiceMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ShowProfileComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
