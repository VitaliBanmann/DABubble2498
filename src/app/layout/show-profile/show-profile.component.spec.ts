import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ShowProfileComponent } from './show-profile.component';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';

class AuthServiceMock {
    authReady$ = of(true);
    currentUser$ = of(null);

    getCurrentUser() {
        return null;
    }
}

class UserServiceMock {
    getUserRealtime() {
        return of(null);
    }

    updateCurrentUserProfile() {
        return Promise.resolve();
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

    it('should not enter edit mode for guest users', () => {
        component.isGuestUser = true;

        component.enterEditMode();

        expect(component.isEditing).toBeFalse();
    });

    it('should not persist profile changes for guest users', async () => {
        component.isGuestUser = true;
        component.editDisplayName = 'Gast';
        const userService = TestBed.inject(UserService);
        const updateSpy = spyOn(userService, 'updateCurrentUserProfile').and.callThrough();

        await component.saveProfileEdit();

        expect(updateSpy).not.toHaveBeenCalled();
    });
});
