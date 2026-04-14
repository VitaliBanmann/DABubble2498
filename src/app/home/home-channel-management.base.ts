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
    channelPopupLeft = 24;
    channelPopupTop = 100;
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

        this.positionChannelPopup();
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;
        this.isChannelPopupOpen = true;
        this.debugDeleteState();
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

        this.positionChannelMembersPopup();
        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = true;
    }

    closeChannelMembersPopup(): void {
        this.isChannelMembersPopupOpen = false;
    }

    protected positionChannelMembersPopup(): void {
        const el = this.membersAvatarTriggerRef?.nativeElement;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const pw = Math.min(415, vw - 48);

        this.channelMembersPopupLeft = Math.min(
            Math.max(Math.round(rect.right - pw), 24),
            Math.max(24, vw - pw - 24),
        );
        this.channelMembersPopupTop = Math.round(rect.bottom + 12);
    }

    protected positionChannelPopup(): void {
        const el = this.channelTitleTriggerRef?.nativeElement;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const pw = Math.min(760, vw - 48);

        this.channelPopupLeft = Math.min(
            Math.max(Math.round(rect.left), 24),
            Math.max(24, vw - pw - 24),
        );
        this.channelPopupTop = Math.round(rect.bottom + 12);
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
        const code =
            typeof (this as any).extractFirebaseErrorCode === 'function'
                ? (this as any).extractFirebaseErrorCode(error)
                : '';

        if (code === 'permission-denied') {
            if (action === 'delete') {
                return 'Channel konnte nicht gelöscht werden (keine Berechtigung).';
            }

            if (action === 'add-member' || action === 'remove-member') {
                return 'Mitglieder konnten nicht aktualisiert werden (keine Berechtigung).';
            }

            return 'Änderung konnte nicht gespeichert werden (keine Berechtigung).';
        }

        if (action === 'name') {
            return 'Channel-Name konnte nicht gespeichert werden. Bitte erneut versuchen.';
        }

        if (action === 'description') {
            return 'Channel-Beschreibung konnte nicht gespeichert werden. Bitte erneut versuchen.';
        }

        if (action === 'add-member') {
            return 'Mitglied konnte nicht hinzugefügt werden. Bitte erneut versuchen.';
        }

        if (action === 'remove-member') {
            return 'Mitglied konnte nicht entfernt werden. Bitte erneut versuchen.';
        }

        return 'Channel konnte nicht gelöscht werden. Bitte erneut versuchen.';
    }

    onChannelNameChanged(nextName: string): void {
        const name = nextName.trim();

        if (!name || this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        const currentName = this.currentChannelName.trim();

        this.errorMessage = '';

        if (this.normalizeChannelNameForComparison(name) === this.normalizeChannelNameForComparison(currentName)) {
            return;
        }

        if (this.hasDuplicateChannelName(name, this.currentChannelId)) {
            this.errorMessage = 'Ein Channel mit diesem Namen existiert bereits.';
            return;
        }

        this.channelService
            .updateChannel(this.currentChannelId, { name })
            .pipe(take(1))
            .subscribe({
                next: () => {
                    this.applySuccessfulChannelNameUpdate(name);
                    this.errorMessage = '';
                },
                error: (error: unknown) => {
                    console.error('[CHANNEL NAME UPDATE ERROR]', error);
                    this.errorMessage = this.resolveChannelUpdateErrorMessage('name', error);
                },
            });
    }

    onChannelDescriptionChanged(nextDescription: string): void {
        const description = nextDescription.trim();

        if (!description || this.isDirectMessage || !this.currentChannelId) {
            return;
        }

        const currentDescription = this.currentChannelDescription.trim();

        this.errorMessage = '';

        if (description === currentDescription) {
            return;
        }

        this.channelService
            .updateChannel(this.currentChannelId, { description })
            .pipe(take(1))
            .subscribe({
                next: () => {
                    this.applySuccessfulChannelDescriptionUpdate(description);
                    this.errorMessage = '';
                },
                error: (error: unknown) => {
                    console.error('[CHANNEL DESCRIPTION UPDATE ERROR]', error);
                    this.errorMessage = this.resolveChannelUpdateErrorMessage('description', error);
                },
            });
    }

    onDeleteChannelRequested(): void {
        if (this.isDirectMessage || !this.currentChannelId || !this.currentUserId) {
            return;
        }

        if (!this.canDeleteCurrentChannel) {
            this.errorMessage = 'Nur der Ersteller dieses Channels kann ihn löschen.';
            return;
        }

        const deletedChannelId = this.currentChannelId;
        this.errorMessage = '';

        this.channelService
            .deleteChannel(deletedChannelId)
            .pipe(
                take(1),
                switchMap(() => this.channelService.getAllChannels().pipe(take(1))),
            )
            .subscribe({
                next: (channels: Channel[]) => this.handleChannelDeleted(channels, deletedChannelId),
                error: (error: unknown) => {
                    console.error('[CHANNEL DELETE ERROR]', error);
                    this.errorMessage = this.resolveChannelUpdateErrorMessage('delete', error);
                },
            });
    }

    debugDeleteState(): void {
        const createdBy = (this.currentChannel?.createdBy ?? '').toString().trim();
        const canDelete =
            !this.isDirectMessage &&
            !!this.currentChannelId &&
            !!this.currentUserId &&
            !this.isProtectedDefaultChannel(this.currentChannelId) &&
            !!createdBy &&
            createdBy === this.currentUserId;

        console.log('currentChannelId', this.currentChannelId);
        console.log('currentUserId', this.currentUserId);
        console.log('currentChannel', this.currentChannel);
        console.log('createdBy', createdBy);
        console.log('canDeleteCurrentChannel', canDelete);
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

        this.isChannelPopupOpen = false;
        this.isAddMemberPopupOpen = false;
        this.isChannelMembersPopupOpen = false;

        const nextChannel = channels.find(
            (channel) => !!channel.id && channel.id !== deletedChannelId,
        );

        if (nextChannel?.id) {
            this.router.navigate(['/app/channel', nextChannel.id]);
            return;
        }

        this.router.navigate(['/app']);
    }
}
