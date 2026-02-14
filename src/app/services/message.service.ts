import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Observable } from 'rxjs';
import { query, where, orderBy, Timestamp } from 'firebase/firestore';

export interface Message {
  id?: string;
  text: string;
  senderId: string;
  receiverId?: string;
  channelId?: string;
  timestamp: Timestamp | Date;
  read?: boolean;
  edited?: boolean;
  editedAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class MessageService {
  private messagesCollection = 'messages';

  constructor(
    private firestoreService: FirestoreService,
    private authService: AuthService
  ) { }

  /**
   * Sende eine neue Nachricht
   */
  sendMessage(message: Message): Observable<string> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    return this.firestoreService.addDocument(this.messagesCollection, {
      ...message,
      senderId: currentUser.uid,
      timestamp: new Date(),
      read: false
    });
  }

  /**
   * Rufe Nachrichten für einen Kanal ab
   */
  getChannelMessages(channelId: string): Observable<Message[]> {
    return this.firestoreService.queryDocuments<Message>(
      this.messagesCollection,
      [
        where('channelId', '==', channelId),
        orderBy('timestamp', 'asc')
      ]
    );
  }

  /**
   * Rufe private Nachrichten zwischen zwei Benutzern ab
   */
  getPrivateMessages(otherUserId: string): Observable<Message[]> {
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Vereinfachte Abfrage - in production würde man eine bessere Struktur verwenden
    return this.firestoreService.queryDocuments<Message>(
      this.messagesCollection,
      [
        where('senderId', '==', currentUser.uid),
        where('receiverId', '==', otherUserId),
        orderBy('timestamp', 'asc')
      ]
    );
  }

  /**
   * Aktualisiere eine Nachricht
   */
  updateMessage(messageId: string, updates: Partial<Message>): Observable<void> {
    return this.firestoreService.updateDocument(
      this.messagesCollection,
      messageId,
      { ...updates, editedAt: new Date(), edited: true }
    );
  }

  /**
   * Lösche eine Nachricht
   */
  deleteMessage(messageId: string): Observable<void> {
    return this.firestoreService.deleteDocument(this.messagesCollection, messageId);
  }

  /**
   * Markiere eine Nachricht als gelesen
   */
  markAsRead(messageId: string): Observable<void> {
    return this.firestoreService.updateDocument(
      this.messagesCollection,
      messageId,
      { read: true }
    );
  }
}
