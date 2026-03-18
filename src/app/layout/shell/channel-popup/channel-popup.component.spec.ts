import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChannelPopupComponent } from './channel-popup.component';

describe('ChannelPopupComponent', () => {
  let component: ChannelPopupComponent;
  let fixture: ComponentFixture<ChannelPopupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChannelPopupComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ChannelPopupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

