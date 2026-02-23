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
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class FirestoreService {
  constructor(private readonly firestore: Firestore) {}

  addDocument<T>(collectionName: string, data: T): Observable<string> {
    return from(
      addDoc(collection(this.firestore, collectionName), data).then(
        (docRef) => docRef.id,
      ),
    );
  }

  getDocuments<T>(collectionName: string): Observable<T[]> {
    return from(
      getDocs(collection(this.firestore, collectionName)).then((querySnapshot) =>
        querySnapshot.docs.map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            }) as T,
        ),
      ),
    );
  }

  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    return from(
      getDoc(doc(this.firestore, collectionName, docId)).then((docSnap) => {
        if (docSnap.exists()) {
          return { id: docSnap.id, ...docSnap.data() } as T;
        }
        return null;
      }),
    );
  }

  updateDocument<T>(
    collectionName: string,
    docId: string,
    data: Partial<T>,
  ): Observable<void> {
    return from(updateDoc(doc(this.firestore, collectionName, docId), data as any));
  }

  deleteDocument(collectionName: string, docId: string): Observable<void> {
    return from(deleteDoc(doc(this.firestore, collectionName, docId)));
  }

  queryDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[],
  ): Observable<T[]> {
    return from(
      getDocs(query(collection(this.firestore, collectionName), ...constraints)).then(
        (querySnapshot) =>
          querySnapshot.docs.map(
            (d) =>
              ({
                id: d.id,
                ...d.data(),
              }) as T,
          ),
      ),
    );
  }
}