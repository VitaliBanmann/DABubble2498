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

    getUserProfileRealtime(userId: string, email: string): Observable<User | null> {
        return this.getUserRealtime(userId).pipe(
            switchMap((user) => {
                if (user) {
                    return of(user);
                }
                return this.getUserByEmailRealtime(email);
            }),
        );
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

    /**
     * Aktualisiere den Profil des aktuellen Benutzers
     */
    async updateCurrentUserProfile(updates: Partial<User>): Promise<void> {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        const existingProfile = await firstValueFrom(
            this.getUser(currentUser.uid).pipe(take(1)),
        );

        if (existingProfile) {
            const ensuredEmail =
                updates.email || existingProfile.email || currentUser.email || '';

            await firstValueFrom(
                this.updateUser(currentUser.uid, {
                    ...updates,
                    email: ensuredEmail,
                }),
            );
            return;
        }

        const newUser: User = {
            email: updates.email || currentUser.email || '',
            displayName: updates.displayName || currentUser.displayName || 'Gast',
            avatar: updates.avatar,
        };

        await firstValueFrom(
            this.firestoreService.setDocument(this.usersCollection, currentUser.uid, {
                ...newUser,
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
            currentUser.email || '',
            currentUser.displayName || 'Gast',
        );
    }

    async upsertUserPresence(
        userId: string,
        status: PresenceStatus,
        email: string,
        displayName: string,
    ): Promise<void> {
        const existingProfile = await firstValueFrom(this.getUser(userId).pipe(take(1)));

        if (existingProfile) {
            await firstValueFrom(
                this.updateUser(userId, {
                    presenceStatus: status,
                    lastSeen: new Date(),
                }),
            );
            return;
        }

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
}
