import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Observable, firstValueFrom, map, of, switchMap, take } from 'rxjs';
import { where } from 'firebase/firestore';

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface User extends Record<string, unknown> {
    id?: string;
    email: string;
    displayName: string;
    avatar?: string;
    presenceStatus?: PresenceStatus;
    lastSeen?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

@Injectable({
    providedIn: 'root',
})
export class UserService {
    private usersCollection = 'users';

    constructor(
        private firestoreService: FirestoreService,
        private authService: AuthService,
    ) {}

    /**
     * Erstelle einen neuen Benutzer in Firestore
     */
    createUser(user: User): Observable<string> {
        return this.firestoreService.addDocument(this.usersCollection, {
            ...user,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    /**
     * Rufe einen Benutzer nach ID ab
     */
    getUser(userId: string): Observable<User | null> {
        return this.firestoreService.getDocument<User>(
            this.usersCollection,
            userId,
        );
    }

    /**
     * Rufe einen Benutzer nach ID ab mit Real-time Updates
     */
    getUserRealtime(userId: string): Observable<User | null> {
        return this.firestoreService.getDocumentRealtime<User>(
            this.usersCollection,
            userId,
        );
    }

    getUserByEmailRealtime(email: string): Observable<User | null> {
        const normalized = email.trim();
        if (!normalized) {
            return of(null);
        }

        return this.firestoreService
            .queryDocumentsRealtime<User>(this.usersCollection, [
                where('email', '==', normalized),
            ])
            .pipe(map((users) => users[0] ?? null));
    }

    getUserByEmail(email: string): Observable<User | null> {
        const normalized = email.trim();
        if (!normalized) {
            return of(null);
        }

        return this.firestoreService
            .queryDocuments<User>(this.usersCollection, [
                where('email', '==', normalized),
            ])
            .pipe(map((users) => users[0] ?? null));
    }

    getUserProfileRealtime(userId: string, _email: string): Observable<User | null> {
        return this.getUserRealtime(userId);
    }

    getUserProfile(userId: string, email: string): Observable<User | null> {
        return this.getUser(userId).pipe(
            switchMap((user) => {
                if (user) {
                    return of(user);
                }
                return this.getUserByEmail(email);
            }),
        );
    }

    /**
     * Aktualisiere einen Benutzer
     */
    updateUser(userId: string, updates: Partial<User>): Observable<void> {
        return this.firestoreService.updateDocument(
            this.usersCollection,
            userId,
            { ...updates, updatedAt: new Date() },
        );
    }

    /**
     * Lösche einen Benutzer
     */
    deleteUser(userId: string): Observable<void> {
        return this.firestoreService.deleteDocument(
            this.usersCollection,
            userId,
        );
    }

    /**
     * Rufe alle Benutzer ab
     */
    getAllUsers(): Observable<User[]> {
        return this.firestoreService.getDocuments<User>(this.usersCollection);
    }

    getAllUsersRealtime(): Observable<User[]> {
        return this.firestoreService.queryDocumentsRealtime<User>(
            this.usersCollection,
            [],
        );
    }

    /**
     * Aktualisiere den Profil des aktuellen Benutzers
     */
    async updateCurrentUserProfile(updates: Partial<User>): Promise<void> {
        const currentUser = this.requireCurrentUser();
        const identity = this.resolveProfileIdentity(currentUser, updates);
        const existingProfile = await this.getExistingProfile(currentUser.uid);
        await this.persistCurrentUserProfile(currentUser, existingProfile, updates, identity);
    }

    private requireCurrentUser() {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        return currentUser;
    }

    private resolveProfileIdentity(currentUser: { email: string | null; providerData: Array<{ email: string | null }> }, updates: Partial<User>) {
        return {
            authEmail: this.resolveAuthEmail(currentUser),
            updateEmail: (updates.email ?? '').trim(),
        };
    }

    private async persistCurrentUserProfile(
        currentUser: { uid: string; isAnonymous: boolean; displayName: string | null },
        existingProfile: User | null,
        updates: Partial<User>,
        identity: { authEmail: string; updateEmail: string },
    ): Promise<void> {
        if (existingProfile) {
            await this.updateExistingProfile(
                currentUser,
                existingProfile,
                updates,
                identity.authEmail,
                identity.updateEmail,
            );
            return;
        }

        await this.createNewProfile(currentUser, updates, identity.authEmail, identity.updateEmail);
    }

    private async getExistingProfile(userId: string): Promise<User | null> {
        return firstValueFrom(this.getUser(userId).pipe(take(1)));
    }

    private async updateExistingProfile(
        currentUser: { uid: string; isAnonymous: boolean },
        existingProfile: User,
        updates: Partial<User>,
        authEmail: string,
        updateEmail: string,
    ): Promise<void> {
        const ensuredEmail = this.resolveEnsuredEmail(existingProfile, authEmail, updateEmail);
        this.assertEmailForRegularUser(currentUser.isAnonymous, ensuredEmail);
        await firstValueFrom(this.updateUser(currentUser.uid, { ...updates, email: ensuredEmail }));
    }

    private async createNewProfile(
        currentUser: { uid: string; isAnonymous: boolean; displayName: string | null },
        updates: Partial<User>,
        authEmail: string,
        updateEmail: string,
    ): Promise<void> {
        const newUser = this.buildNewUser(currentUser, updates, authEmail, updateEmail);
        this.assertEmailForRegularUser(currentUser.isAnonymous, newUser.email);
        await this.setUserDocument(currentUser.uid, newUser);
    }

    private resolveEnsuredEmail(existingProfile: User, authEmail: string, updateEmail: string): string {
        return updateEmail || (existingProfile.email ?? '').trim() || authEmail;
    }

    private buildNewUser(
        currentUser: { displayName: string | null },
        updates: Partial<User>,
        authEmail: string,
        updateEmail: string,
    ): User {
        return {
            email: updateEmail || authEmail,
            displayName: updates.displayName || currentUser.displayName || 'Gast',
            avatar: updates.avatar,
        };
    }

    private assertEmailForRegularUser(isAnonymous: boolean, email: string): void {
        if (!isAnonymous && !email) {
            throw new Error('Authenticated users must have an email.');
        }
    }

    private async setUserDocument(userId: string, user: User): Promise<void> {
        await firstValueFrom(
            this.firestoreService.setDocument(this.usersCollection, userId, {
                ...user,
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        );
    }

    async updateCurrentUserPresence(status: PresenceStatus): Promise<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            return;
        }

        await this.upsertUserPresence(
            currentUser.uid,
            status,
            this.resolveAuthEmail(currentUser),
            currentUser.displayName || 'Gast',
        );
    }

    async upsertUserPresence(
        userId: string,
        status: PresenceStatus,
        email: string,
        displayName: string,
    ): Promise<void> {
        const existingProfile = await this.getExistingProfile(userId);
        if (existingProfile) {
            await this.updatePresenceOnExistingUser(userId, existingProfile, status, email);
            return;
        }

        await this.createPresenceUser(userId, status, email, displayName);
    }

    private async updatePresenceOnExistingUser(
        userId: string,
        existingProfile: User,
        status: PresenceStatus,
        email: string,
    ): Promise<void> {
        const existingEmail = (existingProfile.email ?? '').trim();
        const normalizedEmail = (email ?? '').trim();
        const optionalEmail = existingEmail || !normalizedEmail ? {} : { email: normalizedEmail };
        await firstValueFrom(this.updateUser(userId, { ...optionalEmail, presenceStatus: status, lastSeen: new Date() }));
    }

    private async createPresenceUser(
        userId: string,
        status: PresenceStatus,
        email: string,
        displayName: string,
    ): Promise<void> {
        await firstValueFrom(
            this.firestoreService.setDocument(this.usersCollection, userId, {
                email,
                displayName,
                presenceStatus: status,
                lastSeen: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        );
    }

    private resolveAuthEmail(user: {
        email: string | null;
        providerData: Array<{ email: string | null }>;
    }): string {
        const direct = (user.email ?? '').trim();
        if (direct) {
            return direct;
        }

        const fromProvider = user.providerData.find(
            (provider) => (provider.email ?? '').trim().length > 0,
        )?.email;

        return (fromProvider ?? '').trim();
    }
}
