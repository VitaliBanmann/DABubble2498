import { CommonModule } from '@angular/common';
import {
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    HostListener,
    Input,
    OnDestroy,
    Output,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface AddMemberPopupUser {
    id: string;
    displayName: string;
    avatar: string;
    isOnline: boolean;
}

@Component({
    selector: 'app-add-member-to-channel',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './add-member-to-channel.component.html',
    styleUrl: './add-member-to-channel.component.scss',
})
export class AddMemberToChannelComponent
    implements AfterViewInit, OnDestroy
{
    @Input() channelName = 'Entwicklerteam';
    @Input() availableUsers: AddMemberPopupUser[] = [];
    @Output() close = new EventEmitter<void>();
    @Output() addMember = new EventEmitter<string>();

    @ViewChild('searchInput')
    searchInputRef?: ElementRef<HTMLInputElement>;

    searchValue = '';
    visibleSuggestions: AddMemberPopupUser[] = [];
    showSuggestions = false;
    selectedUserId: string | null = null;

    private previousBodyOverflow = '';
    private previousBodyPaddingRight = '';
    private previousHtmlOverflow = '';

    /** Handles after view init. */
    ngAfterViewInit(): void {
        this.lockBackgroundScroll();
        this.focusInputSoon();
    }

    /** Handles ng on destroy. */
    ngOnDestroy(): void {
        this.unlockBackgroundScroll();
    }

    /** Handles escape key. */
    @HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: Event): void {
        event.preventDefault();
        this.onClose();
    }

    /** Handles viewport changes. */
    @HostListener('window:resize')
    onWindowResize(): void {
        this.focusInputSoon(2);
    }

    /** Handles on close. */
    onClose(): void {
        this.close.emit();
    }

    /** Handles on search input. */
    onSearchInput(): void {
        this.applySearchState(false);
    }

    /** Handles on search focus. */
    onSearchFocus(): void {
        this.applySearchState(true);
    }

    /** Handles on search blur. */
    onSearchBlur(): void {
        // Allow suggestion-item click to run before closing the list.
        setTimeout(() => {
            this.showSuggestions = false;
        }, 120);
    }

    /** Handles on suggestion select. */
    onSuggestionSelect(user: AddMemberPopupUser): void {
        this.selectedUserId = user.id;
        this.searchValue = user.displayName;
        this.showSuggestions = false;
        this.focusInputSoon(2);
    }

    /** Handles on submit click. */
    onSubmitClick(): void {
        this.showSuggestions = false;
        const selected = this.resolveSelectedUserId();
        if (!selected) {
            return;
        }

        this.addMember.emit(selected);
    }

    /** Handles can submit selection. */
    canSubmitSelection(): boolean {
        return !!this.resolveSelectedUserId();
    }

    /** Focuses the input with small retries so it also works after render/keyboard changes. */
    private focusInputSoon(attempts = 6): void {
        const run = (remaining: number) => {
            requestAnimationFrame(() => {
                const input = this.searchInputRef?.nativeElement ?? null;

                if (input) {
                    input.focus();
                    const end = input.value.length;
                    input.setSelectionRange(end, end);
                    return;
                }

                if (remaining > 1) {
                    setTimeout(() => run(remaining - 1), 50);
                }
            });
        };

        run(attempts);
    }

    /** Locks page scrolling while the modal is open. */
    private lockBackgroundScroll(): void {
        const body = document.body;
        const html = document.documentElement;
        const scrollbarWidth =
            window.innerWidth - document.documentElement.clientWidth;

        this.previousBodyOverflow = body.style.overflow;
        this.previousBodyPaddingRight = body.style.paddingRight;
        this.previousHtmlOverflow = html.style.overflow;

        body.style.overflow = 'hidden';
        html.style.overflow = 'hidden';

        if (scrollbarWidth > 0) {
            body.style.paddingRight = `${scrollbarWidth}px`;
        }
    }

    /** Restores page scrolling after modal close/destroy. */
    private unlockBackgroundScroll(): void {
        const body = document.body;
        const html = document.documentElement;

        body.style.overflow = this.previousBodyOverflow;
        body.style.paddingRight = this.previousBodyPaddingRight;
        html.style.overflow = this.previousHtmlOverflow;
    }

    /** Handles resolve selected user id. */
    private resolveSelectedUserId(): string | null {
        if (this.selectedUserId) {
            return this.selectedUserId;
        }

        const token = this.searchValue.trim().toLowerCase();
        if (!token) {
            return null;
        }

        const directMatch = this.availableUsers.find(
            (user) => user.displayName.trim().toLowerCase() === token,
        );

        return directMatch?.id ?? null;
    }

    /** Handles apply search state. */
    /** Handles apply search state. */
    private applySearchState(_isFocus: boolean): void {
        const token = this.searchValue.trim().toLowerCase();

        if (!token) {
            this.selectedUserId = null;
            this.visibleSuggestions = [];
            this.showSuggestions = false;
            return;
        }

        const exactMatch = this.availableUsers.find(
            (user) => user.displayName.trim().toLowerCase() === token,
        );

        this.selectedUserId = exactMatch?.id ?? null;
        this.visibleSuggestions = this.availableUsers
            .filter((user) =>
                user.displayName.toLowerCase().includes(token),
            )
            .slice(0, 8);

        // If user already typed an exact member name, keep the list closed so
        // the submit button is directly clickable with one click.
        if (exactMatch) {
            this.showSuggestions = false;
            return;
        }

        this.showSuggestions = this.visibleSuggestions.length > 0;
    }
}
