import { of } from 'rxjs';

export class AuthServiceMock {
  authReady$ = of(true);
  currentUser$ = of(null);

  /** Handles get current user. */
    getCurrentUser() {
    return null;
  }

  /** Handles logout. */
    logout(): Promise<void> {
    return Promise.resolve();
  }
}

export class UserServiceMock {
  /** Handles get all users realtime. */
    getAllUsersRealtime() {
    return of([]);
  }

  /** Handles get user profile realtime. */
    getUserProfileRealtime() {
    return of(null);
  }

  /** Handles search users by token. */
    searchUsersByToken() {
    return of([]);
  }
}

export class ChannelServiceMock {
  /** Handles get all channels. */
    getAllChannels() {
    return of([]);
  }

  /** Handles search channels by token. */
    searchChannelsByToken() {
    return of([]);
  }
}

export class MessageServiceMock {
  /** Handles search messages by token. */
    searchMessagesByToken() {
    return of([]);
  }
}

export class PresenceServiceMock {
  /** Handles set status. */
    setStatus(): Promise<void> {
    return Promise.resolve();
  }
}

export class UnreadStateServiceMock {
  /** Handles observe unread state. */
    observeUnreadState() {
    return of([]);
  }
}
