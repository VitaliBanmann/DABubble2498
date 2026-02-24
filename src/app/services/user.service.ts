import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Observable, take } from 'rxjs';

export interface User extends Record<string, unknown> {
    id?: string;
    email: string;
    displayName: string;
    avatar?: string;
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
    updateCurrentUserProfile(updates: Partial<User>): void {
        const currentUser = this.authService.getCurrentUser();
        if (!currentUser) {
            return;
        }

        this.getUser(currentUser.uid)
            .pipe(take(1))
            .subscribe({
                next: (existingProfile) => {
                    if (existingProfile) {
                        this.updateUser(currentUser.uid, updates).subscribe({
                            next: () =>
                                console.log('Profile updated successfully'),
                            error: (error) =>
                                console.error('Error updating profile:', error),
                        });
                    } else {
                        const newUser: User = {
                            email: currentUser.email || '',
                            displayName:
                                updates.displayName ||
                                currentUser.displayName ||
                                'Gast',
                            avatar: updates.avatar,
                        };

                        this.firestoreService
                            .setDocument(this.usersCollection, currentUser.uid, {
                                ...newUser,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            })
                            .subscribe({
                                next: () =>
                                    console.log(
                                        'Profile created successfully',
                                    ),
                                error: (error) =>
                                    console.error(
                                        'Error creating profile:',
                                        error,
                                    ),
                            });
                    }
                },
                error: (error) =>
                    console.error('Error checking profile:', error),
            });
    }
}
