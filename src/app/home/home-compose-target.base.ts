import { Injectable } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Channel } from '../services/channel.service';
import { User } from '../services/user.service';
import {
    ComposeTargetSuggestion,
    ComposerTagSuggestion,
    MentionCandidate,
} from './home.component.models';
import { HomeMessageGroupsBase } from './home-message-groups.base';

@Injectable()
export abstract class HomeComposeTargetBase extends HomeMessageGroupsBase {
    protected readonly composeSuggestionLimit = 50;
    readonly composeTargetControl = new FormControl('', { nonNullable: true });

    composeTargetSuggestions: ComposeTargetSuggestion[] = [];
    composeTargetActiveIndex = -1;
    showComposeTargetSuggestions = false;

    composeResolvedTarget:
        | { kind: 'channel'; channelId: string }
        | { kind: 'user'; userId: string }
        | null = null;

    readonly channelNames: Record<string, string> = {
        allgemein: 'Allgemein',
        entwicklerteam: 'Entwicklerteam',
    };

    readonly channelDescriptions: Record<string, string> = {
        allgemein: 'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
        entwicklerteam: 'Dieser Channel ist fuer alles rund um #dfsdf vorgesehen. Hier kannst du zusammen mit deinem Team Meetings abhalten, Dokumente teilen und Entscheidungen treffen.',
    };

    /** Handles on compose target input. */
    onComposeTargetInput(): void {
        this.composeTargetActiveIndex = -1;
        this.errorMessage = '';
        this.updateComposeTargetSuggestions();
    }

    /** Handles on compose target submit. */
    async onComposeTargetSubmit(): Promise<void> {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) {
            this.applyComposeTargetError('Bitte gib ein Ziel ein (#channel, @user oder E-Mail).');
            return;
        }
        this.hideComposeTargetSuggestions();
        this.resolveComposeTarget(raw);
    }

    /** Handles resolve compose target. */
    protected resolveComposeTarget(raw: string): void {
        const channelId = this.resolveChannelTarget(raw);
        if (channelId) return this.applyComposeChannelTarget(channelId);
        const user = this.resolveDirectTarget(raw);
        if (!user?.id) return this.applyComposeTargetError('Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.');
        if (user.id === this.currentUserId) return this.applyComposeTargetError('Direktnachricht an dich selbst ist nicht noetig.');
        this.composeResolvedTarget = { kind: 'user', userId: user.id };
        this.errorMessage = '';
    }

    /** Handles apply compose channel target. */
    protected applyComposeChannelTarget(channelId: string): void {
        this.composeResolvedTarget = { kind: 'channel', channelId };
        this.errorMessage = '';
    }

    /** Handles apply compose target error. */
    protected applyComposeTargetError(message: string): void {
        this.errorMessage = message;
        this.composeResolvedTarget = null;
    }

    /** Handles resolve channel target. */
    protected resolveChannelTarget(input: string): string | null {
        const token = input.replace(/^#/, '').trim().toLowerCase();
        if (!token) return null;
        const byId = Object.keys(this.channelNames).find((id) => id.toLowerCase() === token);
        if (byId) return byId;
        const byLabel = (Object.entries(this.channelNames) as Array<[string, string]>)
            .find(([, label]) => label.toLowerCase() === token);
        return byLabel?.[0] ?? null;
    }

    /** Handles resolve direct target. */
    protected resolveDirectTarget(input: string): User | null {
        const token = input.replace(/^@/, '').trim().toLowerCase();
        if (!token) return null;
        const allUsers = Object.values(this.usersById) as User[];
        return this.findDirectTargetMatch(allUsers, token);
    }

    /** Handles find direct target match. */
    protected findDirectTargetMatch(users: User[], token: string): User | null {
        return (
            users.find((u) => (u.email ?? '').trim().toLowerCase() === token) ||
            users.find((u) => (u.displayName ?? '').trim().toLowerCase() === token) ||
            users.find((u) => (u.displayName ?? '').trim().toLowerCase().includes(token)) ||
            null
        );
    }

    /** Handles select compose target suggestion. */
    selectComposeTargetSuggestion(suggestion: ComposeTargetSuggestion): void {
        this.composeTargetControl.setValue(suggestion.value);
        this.hideComposeTargetSuggestions();
    }

    /** Handles update compose target suggestions. */
    protected updateComposeTargetSuggestions(): void {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) return this.hideComposeTargetSuggestions();
        const query = raw.slice(1).trim().toLowerCase();
        if (raw.startsWith('#')) return this.setChannelSuggestions(query);
        if (raw.startsWith('@')) return this.setUserSuggestions(query);
        this.hideComposeTargetSuggestions();
    }

    /** Handles set channel suggestions. */
    protected setChannelSuggestions(query: string): void {
        const entries = (Object.entries(this.channelNames) as Array<[string, string]>)
            .sort((left, right) => left[1].localeCompare(right[1], 'de'))
            .filter(([id, label]) =>
                !query ||
                this.normalizeSuggestionToken(id).includes(this.normalizeSuggestionToken(query)) ||
                this.normalizeSuggestionToken(label).includes(this.normalizeSuggestionToken(query)),
            )
            .slice(0, this.composeSuggestionLimit)
            .map(([id, label]): ComposeTargetSuggestion => ({
                kind: 'channel', id, label: `#${label}`, value: `#${id}`, subtitle: `Channel: #${id}`,
            }));
        this.applyComposeSuggestions(entries);
    }

    /** Handles set user suggestions. */
    protected setUserSuggestions(query: string): void {
        const entries = (Object.values(this.usersById) as User[])
            .filter((u) => !!u.id && u.id !== this.currentUserId)
            .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))
            .filter((u) => !query ||
                this.normalizeSuggestionToken(u.displayName ?? '').includes(
                    this.normalizeSuggestionToken(query),
                ) ||
                this.normalizeSuggestionToken(u.email ?? '').includes(
                    this.normalizeSuggestionToken(query),
                ))
            .slice(0, this.composeSuggestionLimit)
            .map((u): ComposeTargetSuggestion => ({
                kind: 'user', id: u.id as string,
                label: `@${u.displayName}`, value: `@${u.displayName}`, subtitle: u.email ?? '',
            }));
        this.applyComposeSuggestions(entries);
    }

    /** Handles apply compose suggestions. */
    protected applyComposeSuggestions(entries: ComposeTargetSuggestion[]): void {
        this.composeTargetSuggestions = entries;
        this.showComposeTargetSuggestions = entries.length > 0;
        this.composeTargetActiveIndex = entries.length ? 0 : -1;
    }

    /** Handles hide compose target suggestions. */
    protected hideComposeTargetSuggestions(): void {
        this.composeTargetSuggestions = [];
        this.showComposeTargetSuggestions = false;
        this.composeTargetActiveIndex = -1;
    }

    /** Handles on compose target keydown. */
    onComposeTargetKeydown(event: KeyboardEvent): void {
        if (!this.showComposeTargetSuggestions) {
            if (event.key === 'Enter') this.onComposeTargetSubmit();
            return;
        }
        if (event.key === 'ArrowDown') { event.preventDefault(); this.moveComposeSelection(1); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); this.moveComposeSelection(-1); return; }
        if (event.key === 'Enter') { event.preventDefault(); this.confirmActiveSuggestion(); return; }
        if (event.key === 'Escape') this.hideComposeTargetSuggestions();
    }

    /** Handles on compose target blur. */
    onComposeTargetBlur(): void {
        setTimeout(() => this.hideComposeTargetSuggestions(), 100);
    }

    /** Handles on compose target option mouse down. */
    onComposeTargetOptionMouseDown(suggestion: ComposeTargetSuggestion, event: MouseEvent): void {
        event.preventDefault();
        this.selectComposeTargetSuggestion(suggestion);
    }

    /** Handles confirm active suggestion. */
    private confirmActiveSuggestion(): void {
        const item = this.composeTargetSuggestions[this.composeTargetActiveIndex];
        if (item) this.selectComposeTargetSuggestion(item);
        else this.onComposeTargetSubmit();
    }

    /** Handles move compose selection. */
    private moveComposeSelection(step: number): void {
        const len = this.composeTargetSuggestions.length;
        if (!len) return;
        const start = this.composeTargetActiveIndex < 0 ? (step > 0 ? -1 : 0) : this.composeTargetActiveIndex;
        this.composeTargetActiveIndex = (start + step + len) % len;
    }

    /** Handles reset compose target. */
    resetComposeTarget(): void {
        (this as any).ui?.closeNewMessage?.();
        this.composeTargetControl.setValue('');
        this.composeResolvedTarget = null;
    }

    protected mentionSuggestions: ComposerTagSuggestion[] = [];
    protected showMentionSuggestions = false;
    protected selectedMentions = new Map<string, MentionCandidate>();

    /** Returns message control value. */
    protected abstract get messageControlValue(): string;

    /** Keeps channel metadata synced for compose target and # tag suggestions. */
    protected subscribeToChannelsForSuggestions(): void {
        this.subscription.add(
            this.channelService.getAllChannels().subscribe({
                next: (channels) => this.applyChannelSuggestionData(channels),
            }),
        );
    }

    /** Applies realtime channel data into local channel lookup maps. */
    protected applyChannelSuggestionData(channels: Channel[]): void {
        channels.forEach((channel) => {
            const id = (channel.id ?? '').trim();
            if (!id) return;
            const name = (channel.name ?? '').toString().trim();
            if (name) this.channelNames[id] = name;
            const description = (channel.description ?? '').toString().trim();
            if (description) this.channelDescriptions[id] = description;
        });
    }

    /** Handles update mention suggestions. */
    protected updateMentionSuggestions(): void {
        const context = this.extractTagQuery(this.messageControlValue);
        if (!context) {
            this.showMentionSuggestions = false;
            this.mentionSuggestions = [];
            return;
        }

        this.mentionSuggestions = context.trigger === '@'
            ? this.findUserMentionCandidates(context.query)
            : this.findChannelMentionCandidates(context.query);
        this.showMentionSuggestions = this.mentionSuggestions.length > 0;
    }

    /** Returns the currently active @/# tag context near the cursor tail. */
    protected extractTagQuery(value: string): { trigger: '@' | '#'; start: number; query: string } | null {
        const atIndex = value.lastIndexOf('@');
        const hashIndex = value.lastIndexOf('#');
        const start = Math.max(atIndex, hashIndex);
        if (start < 0) return null;

        const trigger = value[start];
        if (trigger !== '@' && trigger !== '#') return null;

        const prevChar = start > 0 ? value[start - 1] : '';
        if (prevChar && !/\s/.test(prevChar)) return null;

        const tail = value.slice(start + 1);
        if (/[\s]/.test(tail)) return null;

        return {
            trigger: trigger as '@' | '#',
            start,
            query: tail.trim().toLowerCase(),
        };
    }

    /** Finds @ mention candidates. */
    protected findUserMentionCandidates(query: string): ComposerTagSuggestion[] {
        const normalizedQuery = this.normalizeSuggestionToken(query);
        return (Object.values(this.usersById) as User[])
            .filter((u) => !!u.id && u.id !== this.currentUserId)
            .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))
            .map((u) => ({ id: u.id as string, label: u.displayName, kind: 'user' as const }))
            .filter((c) => this.normalizeSuggestionToken(c.label).includes(normalizedQuery))
            .slice(0, this.composeSuggestionLimit);
    }

    /** Finds # channel tag candidates. */
    protected findChannelMentionCandidates(query: string): ComposerTagSuggestion[] {
        const normalizedQuery = this.normalizeSuggestionToken(query);
        return (Object.entries(this.channelNames) as Array<[string, string]>)
            .map(([id, label]) => ({ id, label: label || id, kind: 'channel' as const }))
            .sort((left, right) => left.label.localeCompare(right.label, 'de'))
            .filter((channel) => {
                if (!normalizedQuery) return true;
                return this.normalizeSuggestionToken(channel.id).includes(normalizedQuery) ||
                    this.normalizeSuggestionToken(channel.label).includes(normalizedQuery);
            })
            .slice(0, this.composeSuggestionLimit);
    }

    /** Handles select mention. */
    selectMention(candidate: ComposerTagSuggestion): void {
        const value = this.messageControlValue;
        const context = this.extractTagQuery(value);
        if (!context) return;

        const prefix = context.trigger;
        const before = value.slice(0, context.start);
        this.setMessageControlValue(`${before}${prefix}${candidate.label} `);

        if (candidate.kind === 'user') {
            this.selectedMentions.set(candidate.id, {
                id: candidate.id,
                label: candidate.label,
            });
        }

        this.hideMentionSuggestions();
    }

    /** Handles set message control value. */
    protected abstract setMessageControlValue(value: string): void;

    /** Handles remove mention. */
    removeMention(candidateId: string): void { this.selectedMentions.delete(candidateId); }

    /** Handles selected mentions list. */
    selectedMentionsList(): MentionCandidate[] { return Array.from(this.selectedMentions.values()); }

    /** Handles collect mention ids for text. */
    protected collectMentionIdsForText(text: string): string[] {
        const normalized = text.toLowerCase();
        return this.selectedMentionsList()
            .filter((c) => normalized.includes(`@${c.label.toLowerCase()}`))
            .map((c) => c.id);
    }

    /** Handles clear mention selection. */
    protected clearMentionSelection(): void {
        this.selectedMentions.clear();
        this.hideMentionSuggestions();
    }

    /** Handles hide mention suggestions. */
    protected hideMentionSuggestions(): void {
        this.mentionSuggestions = [];
        this.showMentionSuggestions = false;
    }

    /** Normalizes tokens for case- and accent-insensitive matching. */
    protected normalizeSuggestionToken(value: string): string {
        return (value ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .trim();
    }
}
