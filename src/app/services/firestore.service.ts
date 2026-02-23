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
  query,
  where,
  QueryConstraint
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  constructor(private readonly firestore: Firestore) { }

  /**
   * Füge ein neues Dokument zu einer Collection hinzu
   */
  addDocument<T>(collectionName: string, data: T): Observable<string> {
    return from(
      addDoc(collection(this.firestore, collectionName), data as any).then(
        (docRef) => docRef.id
      )
    );
  }

  /**
   * Rufe alle Dokumente aus einer Collection ab
   */
  getDocuments<T>(collectionName: string): Observable<T[]> {
    return from(
      getDocs(collection(this.firestore, collectionName)).then((querySnapshot) => {
        return querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        } as T));
      })
    );
  }

  /**
   * Rufe ein einzelnes Dokument ab
   */
  getDocument<T>(collectionName: string, docId: string): Observable<T | null> {
    return from(
      getDoc(doc(this.firestore, collectionName, docId)).then((docSnap) => {
        if (docSnap.exists()) {
          return { id: docSnap.id, ...docSnap.data() } as T;
        }
        return null;
      })
    );
  }

  /**
   * Aktualisiere ein Dokument
   */
  updateDocument<T>(
    collectionName: string,
    docId: string,
    data: Partial<T>
  ): Observable<void> {
    return from(
      updateDoc(doc(this.firestore, collectionName, docId), data as any)
    );
  }

  /**
   * Erstelle oder ersetze ein Dokument (optional mit Merge)
   */
  setDocument<T>(
    collectionName: string,
    docId: string,
    data: Partial<T>,
    merge: boolean = true
  ): Observable<void> {
    return from(
      setDoc(doc(this.firestore, collectionName, docId), data as any, { merge })
    );
  }

  /**
   * Lösche ein Dokument
   */
  deleteDocument(collectionName: string, docId: string): Observable<void> {
    return from(
      deleteDoc(doc(this.firestore, collectionName, docId))
    );
  }

  /**
   * Abfrage mit Filtern
   */
  queryDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[]
  ): Observable<T[]> {
    return from(
      getDocs(
        query(collection(this.firestore, collectionName), ...constraints)
      ).then((querySnapshot) => {
        return querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        } as T));
      })
    );
  }
}
