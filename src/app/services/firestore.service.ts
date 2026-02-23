import { Injectable } from '@angular/core';
import {
    Firestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc,
    updateDoc,
    deleteDoc,
    query,
    QueryConstraint,
    DocumentData,
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
}
