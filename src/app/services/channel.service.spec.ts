import { firstValueFrom, of } from 'rxjs';
import { ChannelService } from './channel.service';

class MockFirestoreService {
    setDocument = jasmine.createSpy('setDocument').and.returnValue(of(void 0));
    addDocument = jasmine.createSpy('addDocument').and.returnValue(of('id-1'));
    getDocument = jasmine.createSpy('getDocument').and.returnValue(of(null));
    updateDocument = jasmine.createSpy('updateDocument').and.returnValue(of(void 0));
    deleteDocument = jasmine.createSpy('deleteDocument').and.returnValue(of(void 0));
    queryDocuments = jasmine.createSpy('queryDocuments').and.returnValue(of([]));
    queryDocumentsRealtime = jasmine.createSpy('queryDocumentsRealtime').and.returnValue(of([]));
}

class MockAuthService {
    currentUser$ = of({ uid: 'creator-1', isAnonymous: false });

    getCurrentUser() {
        return { uid: 'creator-1', isAnonymous: false };
    }
}

describe('ChannelService security behavior', () => {
    let service: ChannelService;
    let firestore: MockFirestoreService;

    beforeEach(() => {
        firestore = new MockFirestoreService();
        service = new ChannelService(firestore as never, new MockAuthService() as never);
    });

    it('ensures creator is member and admin on createChannelWithId', async () => {
        await firstValueFrom(
            service.createChannelWithId('qa', {
                name: 'QA',
                description: 'test channel',
                members: [],
                admins: [],
                createdBy: 'creator-1',
            }),
        );

        const payload = firestore.setDocument.calls.mostRecent().args[2] as {
            members: string[];
            admins: string[];
        };

        expect(payload.members).toContain('creator-1');
        expect(payload.admins).toContain('creator-1');
    });

    it('adds search tokens for searchable channel fields', async () => {
        await firstValueFrom(
            service.createChannelWithId('frontend', {
                name: 'Frontend Team',
                description: 'UI und Angular',
                members: ['creator-1'],
                admins: ['creator-1'],
                createdBy: 'creator-1',
            }),
        );

        const payload = firestore.setDocument.calls.mostRecent().args[2] as {
            searchTokens?: string[];
        };

        expect(payload.searchTokens).toBeDefined();
        expect((payload.searchTokens ?? []).length).toBeGreaterThan(0);
    });
});
