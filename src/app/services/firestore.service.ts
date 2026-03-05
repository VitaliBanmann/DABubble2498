import { Injectable, NgZone } from '@angular/core';
import {
    Firestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    QueryConstraint,
    DocumentData,
    Query,
} from '@angular/fire/firestore';
import { Observable, from, retry, timer } from 'rxjs';

type WithId = { id: string };

@Injectable({
    providedIn: 'root',
})
export class FirestoreService {
    constructor(
        private readonly firestore: Firestore,
        private readonly zone: NgZone,
    ) {}

    addDocument<T extends Record<string, unknown>>(
        collectionName: string,
        data: T,
    ): Observable<string> {
        // Firestore expects DocumentData-like objects
        const payload = data as unknown as DocumentData;

        return from(
            addDoc(collection(this.firestore, collectionName), payload).then(
                (ref) => ref.id,
            ),
        );
    }

    setDocument<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
        data: T,
    ): Observable<void> {
        const payload = data as unknown as DocumentData;
        return from(
            setDoc(doc(this.firestore, collectionName, docId), payload),
        );
    }

    getDocuments<T extends Record<string, unknown>>(
        collectionName: string,
    ): Observable<(T & WithId)[]> {
        return from(
            getDocs(collection(this.firestore, collectionName)).then((snap) =>
                snap.docs.map((d) => {
                    const data = d.data() as unknown as T;
                    return { id: d.id, ...data };
                }),
            ),
        );
    }

    getDocument<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
    ): Observable<(T & WithId) | null> {
        return from(
            getDoc(doc(this.firestore, collectionName, docId)).then((snap) => {
                if (!snap.exists()) return null;
                const data = snap.data() as unknown as T;
                return { id: snap.id, ...data };
            }),
        );
    }

    getDocumentRealtime<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
    ): Observable<(T & WithId) | null> {
        return new Observable<(T & WithId) | null>((subscriber) => {
            const docRef = doc(this.firestore, collectionName, docId);
            const unsubscribe = onSnapshot(
                docRef,
                (snap) => {
                    this.zone.run(() => {
                        if (subscriber.closed) {
                            return;
                        }
                        if (!snap.exists()) {
                            subscriber.next(null);
                            return;
                        }
                        const data = snap.data() as unknown as T;
                        subscriber.next({ id: snap.id, ...data });
                    });
                },
                (error) => {
                    this.zone.run(() => {
                        if (subscriber.closed) {
                            return;
                        }
                        subscriber.error(error);
                    });
                },
            );
            return () => unsubscribe();
        }).pipe(this.retryOnAuthNotReady());
    }

    updateDocument<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
        data: Partial<T>,
    ): Observable<void> {
        return from(
            updateDoc(doc(this.firestore, collectionName, docId), data as any),
        );
    }

    deleteDocument(collectionName: string, docId: string): Observable<void> {
        return from(deleteDoc(doc(this.firestore, collectionName, docId)));
    }

    queryDocuments<T extends Record<string, unknown>>(
        collectionName: string,
        constraints: QueryConstraint[],
    ): Observable<(T & WithId)[]> {
        return from(
            getDocs(
                query(
                    collection(this.firestore, collectionName),
                    ...constraints,
                ),
            ).then((snap) =>
                snap.docs.map((d) => {
                    const data = d.data() as unknown as T;
                    return { id: d.id, ...data };
                }),
            ),
        );
    }

    queryDocumentsRealtime<T extends Record<string, unknown>>(
        collectionName: string,
        constraints: QueryConstraint[],
    ): Observable<(T & WithId)[]> {
        return new Observable<(T & WithId)[]>((subscriber) => {
            const baseCollection = collection(this.firestore, collectionName);
            const queryRef = query(baseCollection, ...constraints) as Query<DocumentData>;

            const unsubscribe = onSnapshot(
                queryRef,
                (snap) => {
                    this.zone.run(() => {
                        if (subscriber.closed) {
                            return;
                        }
                        subscriber.next(
                            snap.docs.map((docSnapshot) => {
                                const data = docSnapshot.data() as unknown as T;
                                return { id: docSnapshot.id, ...data };
                            }),
                        );
                    });
                },
                (error) => {
                    this.zone.run(() => {
                        if (subscriber.closed) {
                            return;
                        }
                        subscriber.error(error);
                    });
                },
            );

            return () => unsubscribe();
        }).pipe(this.retryOnAuthNotReady());
    }

    private retryOnAuthNotReady<T>(): (source: Observable<T>) => Observable<T> {
        return (source) =>
            source.pipe(
                retry({
                    count: 5,
                    delay: (error, retryCount) => {
                        const code = this.getFirebaseErrorCode(error);
                        if (code !== 'permission-denied' && code !== 'unauthenticated') {
                            throw error;
                        }

                        const delayMs = Math.min(500 * Math.pow(2, retryCount - 1), 4000);
                        return timer(delayMs);
                    },
                }),
            );
    }

    private getFirebaseErrorCode(error: unknown): string | null {
        if (!error || typeof error !== 'object') {
            return null;
        }
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : null;
    }
}
