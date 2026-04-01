import {
    Injectable,
    NgZone,
    EnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
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
import { Observable, from, retry, timer, defer } from 'rxjs';

type WithId = { id: string };

@Injectable({
    providedIn: 'root',
})
export class FirestoreService {
    constructor(
        private readonly firestore: Firestore,
        private readonly zone: NgZone,
        private readonly injector: EnvironmentInjector,
    ) {}

    private inCtx<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    private fromCtxPromise<T>(factory: () => Promise<T>): Observable<T> {
        return defer(() => from(this.inCtx(factory)));
    }

    createDocumentId(collectionName: string): string {
        return this.inCtx(() => doc(collection(this.firestore, collectionName)).id);
    }

    addDocument<T extends Record<string, unknown>>(
        collectionName: string,
        data: T,
    ): Observable<string> {
        // Firestore expects DocumentData-like objects
        const payload = data as unknown as DocumentData;

        return this.fromCtxPromise(() =>
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
        return this.fromCtxPromise(() =>
            setDoc(doc(this.firestore, collectionName, docId), payload),
        );
    }

    getDocuments<T extends Record<string, unknown>>(
        collectionName: string,
    ): Observable<(T & WithId)[]> {
        return this.fromCtxPromise(() =>
            getDocs(collection(this.firestore, collectionName)).then((snap) =>
                snap.docs.map((d) => {
                    const data = d.data() as unknown as T;
                    return { ...data, id: d.id };
                }),
            ),
        );
    }

    getDocument<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
    ): Observable<(T & WithId) | null> {
        return this.fromCtxPromise(() =>
            getDoc(doc(this.firestore, collectionName, docId)).then((snap) => {
                if (!snap.exists()) return null;
                const data = snap.data() as unknown as T;
                return { ...data, id: snap.id };
            }),
        );
    }

    getDocumentRealtime<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
    ): Observable<(T & WithId) | null> {
        return new Observable<(T & WithId) | null>((subscriber) => {
            const unsubscribe = this.inCtx(() => {
                const docRef = doc(this.firestore, collectionName, docId);

                return onSnapshot(
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
                            subscriber.next({ ...data, id: snap.id });
                        });
                    },
                    (error) => {
                        this.zone.run(() => {
                            if (!subscriber.closed) {
                                subscriber.error(error);
                            }
                        });
                    },
                );
            });

            return () => unsubscribe();
        }).pipe(this.retryOnAuthNotReady());
    }

    updateDocument<T extends Record<string, unknown>>(
        collectionName: string,
        docId: string,
        data: Partial<T>,
    ): Observable<void> {
        return this.fromCtxPromise(() =>
            updateDoc(doc(this.firestore, collectionName, docId), data as any),
        );
    }

    deleteDocument(collectionName: string, docId: string): Observable<void> {
        return this.fromCtxPromise(() =>
            deleteDoc(doc(this.firestore, collectionName, docId)),
        );
    }

    queryDocuments<T extends Record<string, unknown>>(
        collectionName: string,
        constraints: QueryConstraint[],
    ): Observable<(T & WithId)[]> {
        return this.fromCtxPromise(() =>
            getDocs(
                query(
                    collection(this.firestore, collectionName),
                    ...constraints,
                ),
            ).then((snap) =>
                snap.docs.map((d) => {
                    const data = d.data() as unknown as T;
                    return { ...data, id: d.id };
                }),
            ),
        );
    }

    queryDocumentsRealtime<T extends Record<string, unknown>>(
        collectionName: string,
        constraints: QueryConstraint[],
    ): Observable<(T & WithId)[]> {
        return new Observable<(T & WithId)[]>((subscriber) => {
            const unsubscribe = this.inCtx(() => {
                const baseCollection = collection(
                    this.firestore,
                    collectionName,
                );
                const queryRef = query(
                    baseCollection,
                    ...constraints,
                ) as Query<DocumentData>;

                return onSnapshot(
                    queryRef,
                    (snap) => {
                        this.zone.run(() => {
                            if (subscriber.closed) {
                                return;
                            }
                            subscriber.next(
                                snap.docs.map((docSnapshot) => {
                                    const data =
                                        docSnapshot.data() as unknown as T;
                                    return { ...data, id: docSnapshot.id };
                                }),
                            );
                        });
                    },
                    (error) => {
                        this.zone.run(() => {
                            if (!subscriber.closed) {
                                subscriber.error(error);
                            }
                        });
                    },
                );
            });

            return () => unsubscribe();
        }).pipe(this.retryOnAuthNotReady());
    }

    private retryOnAuthNotReady<T>(): (source: Observable<T>) => Observable<T> {
        return (source) =>
            source.pipe(
                retry({
                    count: 8,
                    delay: (error, retryCount) => {
                        const code = this.getFirebaseErrorCode(error);
                        if (!this.isRetryableAuthError(code)) {
                            throw error;
                        }

                        const delayMs = Math.min(
                            500 * Math.pow(2, retryCount - 1),
                            6000,
                        );
                        return timer(delayMs);
                    },
                }),
            );
    }

    private isRetryableAuthError(code: string | null): boolean {
        return code === 'unauthenticated' || code === 'permission-denied';
    }

    private getFirebaseErrorCode(error: unknown): string | null {
        if (!error || typeof error !== 'object') {
            return null;
        }
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : null;
    }
}
