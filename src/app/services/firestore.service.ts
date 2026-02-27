import { Injectable } from '@angular/core';
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
import { Observable, from } from 'rxjs';

type WithId = { id: string };

@Injectable({
    providedIn: 'root',
})
export class FirestoreService {
    constructor(private readonly firestore: Firestore) {}

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
        return new Observable((observer) => {
            const docRef = doc(this.firestore, collectionName, docId);
            const unsubscribe = onSnapshot(
                docRef,
                (snap) => {
                    if (!snap.exists()) {
                        observer.next(null);
                        return;
                    }
                    const data = snap.data() as unknown as T;
                    observer.next({ id: snap.id, ...data });
                },
                (error) => {
                    observer.error(error);
                },
            );
            return () => unsubscribe();
        });
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
        return new Observable((observer) => {
            const baseCollection = collection(this.firestore, collectionName);
            const queryRef = query(baseCollection, ...constraints) as Query<DocumentData>;

            const unsubscribe = onSnapshot(
                queryRef,
                (snap) => {
                    observer.next(
                        snap.docs.map((docSnapshot) => {
                            const data = docSnapshot.data() as unknown as T;
                            return { id: docSnapshot.id, ...data };
                        }),
                    );
                },
                (error) => {
                    observer.error(error);
                },
            );

            return () => unsubscribe();
        });
    }
}
