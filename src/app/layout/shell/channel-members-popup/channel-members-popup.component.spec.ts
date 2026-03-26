import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChannelMembersPopupComponent } from './channel-members-popup.component';

describe('ChannelMembersPopupComponent', () => {
    let component: ChannelMembersPopupComponent;
    let fixture: ComponentFixture<ChannelMembersPopupComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ChannelMembersPopupComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(ChannelMembersPopupComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
