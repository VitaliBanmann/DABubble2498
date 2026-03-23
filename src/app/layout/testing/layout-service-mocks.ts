import { of } from 'rxjs';

export class AuthServiceMock {
  authReady$ = of(true);
  currentUser$ = of(null);

  getCurrentUser() {
    return null;
  }

  logout(): Promise<void> {
    return Promise.resolve();
  }
}

export class UserServiceMock {
  getAllUsersRealtime() {
    return of([]);
  }

  getUserProfileRealtime() {
    return of(null);
  }

  searchUsersByToken() {
    return of([]);
  }
}

export class ChannelServiceMock {
  getAllChannels() {
    return of([]);
  }

  searchChannelsByToken() {
    return of([]);
  }
}

export class MessageServiceMock {
  searchMessagesByToken() {
    return of([]);
  }
}

export class PresenceServiceMock {
  setStatus(): Promise<void> {
    return Promise.resolve();
  }
}

export class UnreadStateServiceMock {
  observeUnreadState() {
    return of([]);
  }
}
