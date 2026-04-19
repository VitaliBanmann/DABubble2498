import { Injectable } from '@angular/core';
import { Message } from '../services/message.service';
import { HomeReactionsThreadBase } from './home-reactions-thread.base';

@Injectable()
export abstract class HomeReactionsUiBase extends HomeReactionsThreadBase {
    activeEmojiPicker:
        | { type: 'composer' }
        | { type: 'message'; messageId: string; source: 'toolbar' | 'reactions' }
        | null = null;

    protected readonly mobileToolbarBreakpointPx = 770;
    mobileActiveMessageToolbarId: string | null = null;

    private messageEmojiPickerPlacement: Record<string, 'above' | 'below'> = {};
    private readonly estimatedEmojiPickerHeightPx = 360;
    private readonly emojiPickerSafetyOffsetPx = 12;

    protected abstract toggleReaction(message: Message, emoji: string): void;

    isMobileToolbarMode(): boolean {
        return typeof window !== 'undefined' && window.innerWidth <= this.mobileToolbarBreakpointPx;
    }

    toggleMobileMessageToolbar(message: Message, event?: MouseEvent): void {
        if (!this.isMobileToolbarMode() || !message.id) return;
        event?.stopPropagation();
        this.mobileActiveMessageToolbarId = this.mobileActiveMessageToolbarId === message.id ? null : message.id;
    }

    isMessageToolbarVisible(message: Message): boolean {
        if (!message.id) return false;
        if (!this.isMobileToolbarMode()) return true;
        return this.mobileActiveMessageToolbarId === message.id;
    }

    closeMobileMessageToolbar(): void {
        this.mobileActiveMessageToolbarId = null;
    }

    toggleComposerEmojiPicker(event: MouseEvent): void {
        event.stopPropagation();
        this.activeEmojiPicker = this.activeEmojiPicker?.type === 'composer' ? null : { type: 'composer' };
    }

    toggleMessageEmojiPicker(
        message: Message,
        source: 'toolbar' | 'reactions',
        event: MouseEvent,
    ): void {
        event.stopPropagation();
        if (!message.id || !this.canWrite) return;

        if (this.isMessageEmojiPickerOpen(message, source)) {
            this.closeAllEmojiPickers();
            return;
        }

        const placement = this.resolveMessageEmojiPickerPlacement(event.currentTarget as HTMLElement | null);
        this.setMessageEmojiPickerPlacement(message.id, source, placement);
        this.activeEmojiPicker = { type: 'message', messageId: message.id, source };
    }

    isComposerEmojiPickerOpen(): boolean {
        return this.activeEmojiPicker?.type === 'composer';
    }

    isMessageEmojiPickerOpen(message: Message, source?: 'toolbar' | 'reactions'): boolean {
        if (!message.id || this.activeEmojiPicker?.type !== 'message') return false;
        if (this.activeEmojiPicker.messageId !== message.id) return false;
        return !source || this.activeEmojiPicker.source === source;
    }

    shouldOpenMessageEmojiPickerBelow(
        message: Message,
        source: 'toolbar' | 'reactions',
    ): boolean {
        if (!message.id) return false;
        return this.getMessageEmojiPickerPlacement(message.id, source) === 'below';
    }

    closeAllEmojiPickers(): void {
        this.activeEmojiPicker = null;
    }

    closeComposerEmojiPicker(): void {
        this.closeAllEmojiPickers();
    }

    onComposerEmojiSelect(event: any): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        const textarea = this.composerTextareaRef?.nativeElement;
        if (!emoji || !textarea) return;

        const next = this.insertComposerEmoji(textarea, emoji);
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = next;
            this.resizeComposerTextarea();
        }, 0);
        this.closeAllEmojiPickers();
    }

    protected insertComposerEmoji(textarea: HTMLTextAreaElement, emoji: string): number {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = this.messageControlValue ?? '';
        this.setMessageControlValue(value.substring(0, start) + emoji + value.substring(end));
        return start + emoji.length;
    }

    onMessageEmojiSelect(event: any, message: Message): void {
        const emoji = event?.emoji?.native ?? event?.native ?? '';
        if (!emoji || !message.id) return;
        this.toggleReaction(message, emoji);
        this.closeAllEmojiPickers();
    }

    private getMessageEmojiPickerPlacementKey(
        messageId: string,
        source: 'toolbar' | 'reactions',
    ): string {
        return `${messageId}::${source}`;
    }

    private setMessageEmojiPickerPlacement(
        messageId: string,
        source: 'toolbar' | 'reactions',
        placement: 'above' | 'below',
    ): void {
        this.messageEmojiPickerPlacement[this.getMessageEmojiPickerPlacementKey(messageId, source)] = placement;
    }

    private getMessageEmojiPickerPlacement(
        messageId: string,
        source: 'toolbar' | 'reactions',
    ): 'above' | 'below' {
        const key = this.getMessageEmojiPickerPlacementKey(messageId, source);
        return this.messageEmojiPickerPlacement[key] ?? 'below';
    }

    private resolveMessageEmojiPickerPlacement(triggerElement: HTMLElement | null): 'above' | 'below' {
        if (!triggerElement || typeof window === 'undefined' || typeof document === 'undefined') return 'below';
        const spaces = this.calculateSpacesForPlacement(triggerElement);
        return this.decidePlacementBySpace(spaces);
    }

    private calculateSpacesForPlacement(trigger: HTMLElement): { above: number; below: number; required: number } {
        const triggerRect = trigger.getBoundingClientRect();
        const headerBottom = (document.querySelector('.home-header') as HTMLElement)?.getBoundingClientRect().bottom ?? 0;
        const topLimit = headerBottom + this.emojiPickerSafetyOffsetPx;
        const bottomLimit = window.innerHeight - this.emojiPickerSafetyOffsetPx;
        return {
            above: triggerRect.top - topLimit,
            below: bottomLimit - triggerRect.bottom,
            required: this.estimatedEmojiPickerHeightPx + this.emojiPickerSafetyOffsetPx,
        };
    }

    private decidePlacementBySpace(s: { above: number; below: number; required: number }): 'above' | 'below' {
        if (s.below >= s.required) return 'below';
        if (s.above >= s.required) return 'above';
        return s.below >= s.above ? 'below' : 'above';
    }
}