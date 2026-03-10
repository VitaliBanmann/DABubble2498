import { firstValueFrom, of } from 'rxjs';
import { MessageService } from './message.service';

class MockAuthService {
    getCurrentUser() {
        return { uid: 'user-1' };
    }
}

class MockFirestoreService {
    setDocument = jasmine.createSpy('setDocument').and.returnValue(of(void 0));
    addDocument = jasmine.createSpy('addDocument').and.returnValue(of('id-1'));
    createDocumentId = jasmine.createSpy('createDocumentId').and.returnValue('msg-1');
    queryDocumentsRealtime = jasmine.createSpy('queryDocumentsRealtime').and.returnValue(of([]));
    queryDocuments = jasmine.createSpy('queryDocuments').and.returnValue(of([]));
    getDocument = jasmine.createSpy('getDocument').and.returnValue(of(null));
    updateDocument = jasmine.createSpy('updateDocument').and.returnValue(of(void 0));
    deleteDocument = jasmine.createSpy('deleteDocument').and.returnValue(of(void 0));
    getDocuments = jasmine.createSpy('getDocuments').and.returnValue(of([]));
}

describe('MessageService security validation', () => {
    let service: MessageService;
    let firestore: MockFirestoreService;

    beforeEach(() => {
        firestore = new MockFirestoreService();
        service = new MessageService(firestore as never, new MockAuthService() as never);
    });

    it('rejects messages without text and without attachments', () => {
        expect(() =>
            service.sendMessageWithId('m1', {
                text: '   ',
                senderId: 'user-1',
                channelId: 'allgemein',
                timestamp: new Date(),
            } as never),
        ).toThrowError('Message requires text or attachments');
    });

    it('rejects messages without senderId', () => {
        expect(() =>
            service.sendMessageWithId('m1', {
                text: 'Hallo',
                senderId: '   ',
                channelId: 'allgemein',
                timestamp: new Date(),
            } as never),
        ).toThrowError('Missing senderId');
    });

    it('sanitizes mentions and keeps sender out of mention list', async () => {
        await firstValueFrom(
            service.sendMessageWithId('m1', {
                text: 'Hallo @u2',
                senderId: 'u1',
                channelId: 'allgemein',
                mentions: ['u1', 'u2', 'u2', ''],
                timestamp: new Date(),
            } as never),
        );

        const payload = firestore.setDocument.calls.mostRecent().args[2] as {
            mentions: string[];
        };

        expect(payload.mentions).toEqual(['u2']);
    });

    it('allows attachment-only messages', async () => {
        await firstValueFrom(
            service.sendMessageWithId('m2', {
                text: ' ',
                senderId: 'u1',
                channelId: 'allgemein',
                attachments: [
                    {
                        name: 'a.pdf',
                        path: 'attachments/m2/a.pdf',
                        url: 'https://example.test/a.pdf',
                        size: 128,
                        contentType: 'application/pdf',
                        isImage: false,
                    },
                ],
                timestamp: new Date(),
            } as never),
        );

        const payload = firestore.setDocument.calls.mostRecent().args[2] as {
            attachments: Array<{ name: string }>;
            read: boolean;
        };

        expect(payload.attachments.length).toBe(1);
        expect(payload.attachments[0].name).toBe('a.pdf');
        expect(payload.read).toBeFalse();
    });
});
