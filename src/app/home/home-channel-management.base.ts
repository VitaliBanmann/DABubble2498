import { Injectable } from '@angular/core';
import { ElementRef } from '@angular/core';
import { switchMap, take } from 'rxjs';
import { Channel } from '../services/channel.service';
import { HomeMessageActionsBase } from './home-message-actions.base';

@Injectable()
export abstract class HomeChannelManagementBase extends HomeMessageActionsBase {
    isChannelPopupOpen = false;
    isAddMemberPopupOpen = false;
    isChannelMembersPopupOpen = false;
    channelMembersPopupLeft = 24;
    channelMembersPopupTop = 120;
    hasSentWelcomeMessage = false;

    readonly maxVisibleChannelMembers = 3;

    protected abstract channelTitleTriggerRef?: ElementRef<HTMLElement>;
    protected abstract membersAvatarTriggerRef?: ElementRef<HTMLElement>;
    protected abstract get currentChannelName(): string;
    protected abstract get currentChannelDescription(): string;
    protected abstract get canDeleteCurrentChannel(): boolean;

    openChannelPopup(): void {
        if ((this as any).isComposeMode || this.isDirectMessage) return;

        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isChannelPopupOpen = true;
    }

    closeChannelPopup(): void {
        this.isChannelPopupOpen = false;
    }

    onAddMemberClick(): void {
        this.isChannelPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isAddMemberPopupOpen = true;
    }

    closeAddMemberPopup(): void {
        this.isAddMemberPopupOpen = false;
    }

    onAddMemberSubmit(userId: string): void {
        if (!this.canUpdateChannelMember(userId)) return;

        this.errorMessage = '';

        this.channelService
            .addMemberToChannel(this.currentChannelId, userId)
            .pipe(take(1))
            .subscribe(this.addMemberObserver());
    }

    onRemoveMemberSubmit(userId: string): void {
        if (!this.canUpdateChannelMember(userId)) return;

        this.errorMessage = '';

        this.channelService
            .removeMemberFromChannel(this.currentChannelId, userId)
            .pipe(take(1))
            .subscribe(this.removeMemberObserver());
    }

    openChannelMembersPopup(): void {
        if ((this as any).isComposeMode || this.isDirectMessage) return;

        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = true;
        this.updateChannelMembersPopupPosition();
    }

    closeChannelMembersPopup(): void {
        this.isChannelMembersPopupOpen = false;
    }

    protected positionChannelMembersPopup(): void {
        const el = this.membersAvatarTriggerRef?.nativeElement;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const horizontalMargin = 24;
        const verticalGap = 12;
        const popupWidth = Math.min(415, Math.max(280, vw - horizontalMargin * 2));
        const maxLeft = Math.max(horizontalMargin, vw - popupWidth - horizontalMargin);

        this.channelMembersPopupLeft = Math.min(
            Math.max(Math.round(rect.right - popupWidth), horizontalMargin),
            maxLeft,
        );
        this.channelMembersPopupTop = Math.min(
            Math.round(rect.bottom + verticalGap),
            Math.max(horizontalMargin, vh - horizontalMargin),
        );
    }

    protected updateChannelMembersPopupPosition(): void {
        if (!this.isChannelMembersPopupOpen) {
            return;
        }

        this.positionChannelMembersPopup();
    }

    protected isProtectedDefaultChannel(channelId: string): boolean {
        return ['allgemein', 'entwicklerteam'].includes((channelId ?? '').trim().toLowerCase());
    }

    protected normalizeChannelNameForComparison(value: string): string {
        return (value ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    protected hasDuplicateChannelName(
        nextName: string,
        currentChannelId: string,
    ): boolean {
        const normalizedNextName = this.normalizeChannelNameForComparison(nextName);

        return Object.entries(this.channelNames).some(([channelId, channelName]) => {
            if (channelId === currentChannelId) return false;

            return this.normalizeChannelNameForComparison(channelName) === normalizedNextName;
        });
    }

    protected applySuccessfulChannelNameUpdate(name: string): void {
        this.channelNames[this.currentChannelId] = name;

        if (this.currentChannel) {
            this.currentChannel = { ...this.currentChannel, name };
        }
    }

    protected applySuccessfulChannelDescriptionUpdate(description: string): void {
        this.channelDescriptions[this.currentChannelId] = description;

        if (this.currentChannel) {
            this.currentChannel = { ...this.currentChannel, description };
        }
    }

    protected resolveChannelUpdateErrorMessage(
        action: 'name' | 'description' | 'add-member' | 'remove-member' | 'delete',
        error: unknown,
    ): string {
        const code = this.readFirebaseErrorCode(error);
        if (code === 'permission-denied') return this.permissionDeniedMessage(action);
        return this.defaultActionErrorMessage(action);
    }

    onChannelNameChanged(nextName: string): void {
        const name = nextName.trim();
        if (!this.canProcessChannelNameChange(name)) return;
        this.errorMessage = '';
        if (this.channelNameUnchanged(name)) return;
        if (this.channelNameExists(name)) {
            this.errorMessage = 'Ein Channel mit diesem Namen existiert bereits.';
            return;
        }

        this.saveChannelName(name);
    }

    onChannelDescriptionChanged(nextDescription: string): void {
        const description = nextDescription.trim();
        if (!this.canProcessChannelDescriptionChange(description)) return;
        this.errorMessage = '';
        if (description === this.currentChannelDescription.trim()) return;
        this.saveChannelDescription(description);
    }

    onDeleteChannelRequested(): void {
        if (!this.canProcessChannelDelete()) return;
        if (!this.canDeleteCurrentChannel) {
            this.errorMessage = 'Nur der Ersteller dieses Channels kann ihn löschen.';
            return;
        }

        const deletedChannelId = this.currentChannelId;
        this.errorMessage = '';
        this.deleteChannelAndNavigate(deletedChannelId);
    }

    private canUpdateChannelMember(userId: string): boolean {
        return !!userId && !this.isDirectMessage && !!this.currentChannelId;
    }

    private addMemberObserver() {
        return {
            next: () => {
                this.errorMessage = '';
                this.isAddMemberPopupOpen = false;
            },
            error: (error: unknown) => this.logChannelMemberError('ADD', error),
        };
    }

    private removeMemberObserver() {
        return {
            next: () => {
                this.errorMessage = '';
            },
            error: (error: unknown) => this.logChannelMemberError('REMOVE', error),
        };
    }

    private logChannelMemberError(action: 'ADD' | 'REMOVE', error: unknown): void {
        console.error(`[${action} CHANNEL MEMBER ERROR]`, error);

        this.errorMessage =
            action === 'ADD'
                ? this.resolveChannelUpdateErrorMessage('add-member', error)
                : this.resolveChannelUpdateErrorMessage('remove-member', error);
    }

    private handleChannelDeleted(channels: Channel[], deletedChannelId: string): void {
        delete this.channelNames[deletedChannelId];
        delete this.channelDescriptions[deletedChannelId];

        this.channelService.emitChannelRemove(deletedChannelId);

        this.closeChannelOverlays();
        this.navigateAfterChannelDelete(channels, deletedChannelId);
    }

    private readFirebaseErrorCode(error: unknown): string {
        return typeof (this as any).extractFirebaseErrorCode === 'function'
            ? (this as any).extractFirebaseErrorCode(error)
            : '';
    }

    private permissionDeniedMessage(action: 'name' | 'description' | 'add-member' | 'remove-member' | 'delete'): string {
        if (action === 'delete') return 'Channel konnte nicht gelöscht werden (keine Berechtigung).';
        if (action === 'add-member' || action === 'remove-member') return 'Mitglieder konnten nicht aktualisiert werden (keine Berechtigung).';
        return 'Änderung konnte nicht gespeichert werden (keine Berechtigung).';
    }

    private defaultActionErrorMessage(action: 'name' | 'description' | 'add-member' | 'remove-member' | 'delete'): string {
        if (action === 'name') return 'Channel-Name konnte nicht gespeichert werden. Bitte erneut versuchen.';
        if (action === 'description') return 'Channel-Beschreibung konnte nicht gespeichert werden. Bitte erneut versuchen.';
        if (action === 'add-member') return 'Mitglied konnte nicht hinzugefügt werden. Bitte erneut versuchen.';
        if (action === 'remove-member') return 'Mitglied konnte nicht entfernt werden. Bitte erneut versuchen.';
        return 'Channel konnte nicht gelöscht werden. Bitte erneut versuchen.';
    }

    private canProcessChannelNameChange(name: string): boolean {
        return !!name && !this.isDirectMessage && !!this.currentChannelId;
    }

    private channelNameUnchanged(name: string): boolean {
        const currentName = this.currentChannelName.trim();
        return this.normalizeChannelNameForComparison(name) === this.normalizeChannelNameForComparison(currentName);
    }

    private channelNameExists(name: string): boolean {
        return this.hasDuplicateChannelName(name, this.currentChannelId);
    }

    private saveChannelName(name: string): void {
        this.channelService.updateChannel(this.currentChannelId, { name }).pipe(take(1)).subscribe({
            next: () => this.onChannelNameSaved(name),
            error: (error: unknown) => this.onChannelNameSaveError(error),
        });
    }

    private onChannelNameSaved(name: string): void {
        this.applySuccessfulChannelNameUpdate(name);
        this.errorMessage = '';
    }

    private onChannelNameSaveError(error: unknown): void {
        console.error('[CHANNEL NAME UPDATE ERROR]', error);
        this.errorMessage = this.resolveChannelUpdateErrorMessage('name', error);
    }

    private canProcessChannelDescriptionChange(description: string): boolean {
        return !!description && !this.isDirectMessage && !!this.currentChannelId;
    }

    private saveChannelDescription(description: string): void {
        this.channelService.updateChannel(this.currentChannelId, { description }).pipe(take(1)).subscribe({
            next: () => this.onChannelDescriptionSaved(description),
            error: (error: unknown) => this.onChannelDescriptionSaveError(error),
        });
    }

    private onChannelDescriptionSaved(description: string): void {
        this.applySuccessfulChannelDescriptionUpdate(description);
        this.errorMessage = '';
    }

    private onChannelDescriptionSaveError(error: unknown): void {
        console.error('[CHANNEL DESCRIPTION UPDATE ERROR]', error);
        this.errorMessage = this.resolveChannelUpdateErrorMessage('description', error);
    }

    private canProcessChannelDelete(): boolean {
        return !this.isDirectMessage && !!this.currentChannelId && !!this.currentUserId;
    }

    private deleteChannelAndNavigate(deletedChannelId: string): void {
        this.channelService.deleteChannel(deletedChannelId).pipe(
            take(1),
            switchMap(() => this.channelService.getAllChannels().pipe(take(1))),
        ).subscribe({
            next: (channels: Channel[]) => this.handleChannelDeleted(channels, deletedChannelId),
            error: (error: unknown) => this.onChannelDeleteError(error),
        });
    }

    private onChannelDeleteError(error: unknown): void {
        console.error('[CHANNEL DELETE ERROR]', error);
        this.errorMessage = this.resolveChannelUpdateErrorMessage('delete', error);
    }

    private closeChannelOverlays(): void {
        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
    }

    private navigateAfterChannelDelete(channels: Channel[], deletedChannelId: string): void {
        const nextChannel = channels.find((channel) => !!channel.id && channel.id !== deletedChannelId);
        if (nextChannel?.id) this.router.navigate(['/app/channel', nextChannel.id]);
        else this.router.navigate(['/app']);
    }
}
