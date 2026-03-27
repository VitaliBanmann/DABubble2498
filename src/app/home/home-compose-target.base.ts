import { Injectable } from '@angular/core';
import { FormControl } from '@angular/forms';
import { User } from '../services/user.service';
import { ComposeTargetSuggestion, MentionCandidate } from './home.component.models';
import { HomeMessageGroupsBase } from './home-message-groups.base';

@Injectable()
export abstract class HomeComposeTargetBase extends HomeMessageGroupsBase {
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

    onComposeTargetInput(): void {
        this.composeTargetActiveIndex = -1;
        this.errorMessage = '';
        this.updateComposeTargetSuggestions();
    }

    async onComposeTargetSubmit(): Promise<void> {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) {
            this.applyComposeTargetError('Bitte gib ein Ziel ein (#channel, @user oder E-Mail).');
            return;
        }
        this.hideComposeTargetSuggestions();
        this.resolveComposeTarget(raw);
    }

    protected resolveComposeTarget(raw: string): void {
        const channelId = this.resolveChannelTarget(raw);
        if (channelId) return this.applyComposeChannelTarget(channelId);
        const user = this.resolveDirectTarget(raw);
        if (!user?.id) return this.applyComposeTargetError('Ziel nicht gefunden. Nutze #channel, @Name oder E-Mail.');
        if (user.id === this.currentUserId) return this.applyComposeTargetError('Direktnachricht an dich selbst ist nicht noetig.');
        this.composeResolvedTarget = { kind: 'user', userId: user.id };
        this.errorMessage = '';
    }

    protected applyComposeChannelTarget(channelId: string): void {
        this.composeResolvedTarget = { kind: 'channel', channelId };
        this.errorMessage = '';
    }

    protected applyComposeTargetError(message: string): void {
        this.errorMessage = message;
        this.composeResolvedTarget = null;
    }

    protected resolveChannelTarget(input: string): string | null {
        const token = input.replace(/^#/, '').trim().toLowerCase();
        if (!token) return null;
        const byId = Object.keys(this.channelNames).find((id) => id.toLowerCase() === token);
        if (byId) return byId;
        const byLabel = (Object.entries(this.channelNames) as Array<[string, string]>)
            .find(([, label]) => label.toLowerCase() === token);
        return byLabel?.[0] ?? null;
    }

    protected resolveDirectTarget(input: string): User | null {
        const token = input.replace(/^@/, '').trim().toLowerCase();
        if (!token) return null;
        const allUsers = Object.values(this.usersById) as User[];
        return this.findDirectTargetMatch(allUsers, token);
    }

    protected findDirectTargetMatch(users: User[], token: string): User | null {
        return (
            users.find((u) => (u.email ?? '').trim().toLowerCase() === token) ||
            users.find((u) => (u.displayName ?? '').trim().toLowerCase() === token) ||
            users.find((u) => (u.displayName ?? '').trim().toLowerCase().includes(token)) ||
            null
        );
    }

    selectComposeTargetSuggestion(suggestion: ComposeTargetSuggestion): void {
        this.composeTargetControl.setValue(suggestion.value);
        this.hideComposeTargetSuggestions();
    }

    protected updateComposeTargetSuggestions(): void {
        const raw = this.composeTargetControl.value.trim();
        if (!raw) return this.hideComposeTargetSuggestions();
        const query = raw.slice(1).trim().toLowerCase();
        if (raw.startsWith('#')) return this.setChannelSuggestions(query);
        if (raw.startsWith('@')) return this.setUserSuggestions(query);
        this.hideComposeTargetSuggestions();
    }

    protected setChannelSuggestions(query: string): void {
        const entries = (Object.entries(this.channelNames) as Array<[string, string]>)
            .filter(([id, label]) => !query || id.includes(query) || label.toLowerCase().includes(query))
            .slice(0, 6)
            .map(([id, label]): ComposeTargetSuggestion => ({
                kind: 'channel', id, label: `#${label}`, value: `#${id}`, subtitle: `Channel: #${id}`,
            }));
        this.applyComposeSuggestions(entries);
    }

    protected setUserSuggestions(query: string): void {
        const entries = (Object.values(this.usersById) as User[])
            .filter((u) => !!u.id && u.id !== this.currentUserId)
            .filter((u) => !query ||
                (u.displayName ?? '').toLowerCase().includes(query) ||
                (u.email ?? '').toLowerCase().includes(query))
            .slice(0, 6)
            .map((u): ComposeTargetSuggestion => ({
                kind: 'user', id: u.id as string,
                label: `@${u.displayName}`, value: `@${u.displayName}`, subtitle: u.email ?? '',
            }));
        this.applyComposeSuggestions(entries);
    }

    protected applyComposeSuggestions(entries: ComposeTargetSuggestion[]): void {
        this.composeTargetSuggestions = entries;
        this.showComposeTargetSuggestions = entries.length > 0;
        this.composeTargetActiveIndex = entries.length ? 0 : -1;
    }

    protected hideComposeTargetSuggestions(): void {
        this.composeTargetSuggestions = [];
        this.showComposeTargetSuggestions = false;
        this.composeTargetActiveIndex = -1;
    }

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

    onComposeTargetBlur(): void {
        setTimeout(() => this.hideComposeTargetSuggestions(), 100);
    }

    onComposeTargetOptionMouseDown(suggestion: ComposeTargetSuggestion, event: MouseEvent): void {
        event.preventDefault();
        this.selectComposeTargetSuggestion(suggestion);
    }

    private confirmActiveSuggestion(): void {
        const item = this.composeTargetSuggestions[this.composeTargetActiveIndex];
        if (item) this.selectComposeTargetSuggestion(item);
        else this.onComposeTargetSubmit();
    }

    private moveComposeSelection(step: number): void {
        const len = this.composeTargetSuggestions.length;
        if (!len) return;
        const start = this.composeTargetActiveIndex < 0 ? (step > 0 ? -1 : 0) : this.composeTargetActiveIndex;
        this.composeTargetActiveIndex = (start + step + len) % len;
    }

    resetComposeTarget(): void {
        (this as any).ui?.closeNewMessage?.();
        this.composeTargetControl.setValue('');
        this.composeResolvedTarget = null;
    }

    protected mentionSuggestions: MentionCandidate[] = [];
    protected showMentionSuggestions = false;
    protected selectedMentions = new Map<string, MentionCandidate>();

    protected abstract get messageControlValue(): string;

    protected updateMentionSuggestions(): void {
        const query = this.extractMentionQuery(this.messageControlValue);
        if (query === null) { this.showMentionSuggestions = false; this.mentionSuggestions = []; return; }
        this.mentionSuggestions = this.findMentionCandidates(query);
        this.showMentionSuggestions = this.mentionSuggestions.length > 0;
    }

    protected extractMentionQuery(value: string): string | null {
        const start = value.lastIndexOf('@');
        if (start < 0) return null;
        const tail = value.slice(start + 1);
        if (tail.includes(' ')) return null;
        return tail.trim().toLowerCase();
    }

    protected findMentionCandidates(query: string): MentionCandidate[] {
        return (Object.values(this.usersById) as User[])
            .filter((u) => !!u.id && u.id !== this.currentUserId)
            .map((u) => ({ id: u.id as string, label: u.displayName }))
            .filter((c) => c.label.toLowerCase().includes(query))
            .slice(0, 6);
    }

    selectMention(candidate: MentionCandidate): void {
        const value = this.messageControlValue;
        const start = value.lastIndexOf('@');
        if (start < 0) return;
        const before = value.slice(0, start);
        this.setMessageControlValue(`${before}@${candidate.label} `);
        this.selectedMentions.set(candidate.id, candidate);
        this.hideMentionSuggestions();
    }

    protected abstract setMessageControlValue(value: string): void;

    removeMention(candidateId: string): void { this.selectedMentions.delete(candidateId); }

    selectedMentionsList(): MentionCandidate[] { return Array.from(this.selectedMentions.values()); }

    protected collectMentionIdsForText(text: string): string[] {
        const normalized = text.toLowerCase();
        return this.selectedMentionsList()
            .filter((c) => normalized.includes(`@${c.label.toLowerCase()}`))
            .map((c) => c.id);
    }

    protected clearMentionSelection(): void {
        this.selectedMentions.clear();
        this.hideMentionSuggestions();
    }

    protected hideMentionSuggestions(): void {
        this.mentionSuggestions = [];
        this.showMentionSuggestions = false;
    }
}
