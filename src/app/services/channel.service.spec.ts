import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
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
    private readonly currentUserSubject = new BehaviorSubject({ uid: 'creator-1', isAnonymous: false });
    private readonly authReadySubject = new BehaviorSubject(false);

    currentUser$ = this.currentUserSubject.asObservable();
    authReady$ = this.authReadySubject.asObservable();

    setCurrentUser(user: { uid: string; isAnonymous: boolean } | null) {
        this.currentUserSubject.next(user);
    }

    setAuthReady(ready: boolean) {
        this.authReadySubject.next(ready);
    }

    getCurrentUser() {
        return this.currentUserSubject.value;
    }
}

describe('ChannelService security behavior', () => {
    let service: ChannelService;
    let firestore: MockFirestoreService;
    let auth: MockAuthService;

    beforeEach(() => {
        firestore = new MockFirestoreService();
        auth = new MockAuthService();
        service = new ChannelService(firestore as never, auth as never);
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

    it('loads channels only after auth is ready', async () => {
        service.getAllChannels().subscribe();

        expect(firestore.queryDocumentsRealtime).not.toHaveBeenCalled();

        auth.setAuthReady(true);

        expect(firestore.queryDocumentsRealtime).toHaveBeenCalled();
    });
});
