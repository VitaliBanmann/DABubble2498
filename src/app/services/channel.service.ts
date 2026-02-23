import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { Observable } from 'rxjs';
import { Timestamp } from 'firebase/firestore';

export interface Channel {
  id?: string;
  name: string;
  description?: string;
  members: string[];
  createdBy: string;
  createdAt?: Timestamp | Date;
  updatedAt?: Date;
  avatar?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChannelService {
  private channelsCollection = 'channels';

  constructor(private firestoreService: FirestoreService) { }

  /**
   * Erstelle einen neuen Kanal
   */
  createChannel(channel: Channel): Observable<string> {
    return this.firestoreService.addDocument(this.channelsCollection, {
      ...channel,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  /**
   * Rufe einen Kanal nach ID ab
   */
  getChannel(channelId: string): Observable<Channel | null> {
    return this.firestoreService.getDocument<Channel>(
      this.channelsCollection,
      channelId
    );
  }

  /**
   * Rufe alle Kanäle ab
   */
  getAllChannels(): Observable<Channel[]> {
    return this.firestoreService.getDocuments<Channel>(this.channelsCollection);
  }

  /**
   * Aktualisiere einen Kanal
   */
  updateChannel(channelId: string, updates: Partial<Channel>): Observable<void> {
    return this.firestoreService.updateDocument(
      this.channelsCollection,
      channelId,
      { ...updates, updatedAt: new Date() }
    );
  }

  /**
   * Lösche einen Kanal
   */
  deleteChannel(channelId: string): Observable<void> {
    return this.firestoreService.deleteDocument(this.channelsCollection, channelId);
  }

  /**
   * Füge einen Mitglied zu einem Kanal hinzu
   */
  addMemberToChannel(channelId: string, userId: string): Observable<void> {
    return new Observable((observer) => {
      this.getChannel(channelId).subscribe({
        next: (channel) => {
          if (channel && !channel.members.includes(userId)) {
            const updatedMembers = [...channel.members, userId];
            this.updateChannel(channelId, { members: updatedMembers }).subscribe({
              next: () => observer.next(),
              error: (error) => observer.error(error),
              complete: () => observer.complete()
            });
          } else {
            observer.next();
            observer.complete();
          }
        },
        error: (error) => observer.error(error)
      });
    });
  }

  /**
   * Entferne einen Mitglied aus einem Kanal
   */
  removeMemberFromChannel(channelId: string, userId: string): Observable<void> {
    return new Observable((observer) => {
      this.getChannel(channelId).subscribe({
        next: (channel) => {
          if (channel) {
            const updatedMembers = channel.members.filter(id => id !== userId);
            this.updateChannel(channelId, { members: updatedMembers }).subscribe({
              next: () => observer.next(),
              error: (error) => observer.error(error),
              complete: () => observer.complete()
            });
          } else {
            observer.next();
            observer.complete();
          }
        },
        error: (error) => observer.error(error)
      });
    });
  }
}
