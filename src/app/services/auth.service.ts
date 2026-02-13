import { Injectable } from '@angular/core';
import { 
  getAuth, 
  Auth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = getAuth();
  private currentUserSubject: BehaviorSubject<User | null> = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  constructor() {
    this.initAuthState();
  }

  private initAuthState(): void {
    onAuthStateChanged(this.auth, (user) => {
      this.currentUserSubject.next(user);
    });
  }

  registerWithEmailAndPassword(email: string, password: string): Promise<void> {
    return createUserWithEmailAndPassword(this.auth, email, password)
      .then(() => {
        console.log('User registered successfully');
      })
      .catch((error) => {
        console.error('Registration error:', error);
        throw error;
      });
  }

  loginWithEmailAndPassword(email: string, password: string): Promise<void> {
    return signInWithEmailAndPassword(this.auth, email, password)
      .then(() => {
        console.log('User logged in successfully');
      })
      .catch((error) => {
        console.error('Login error:', error);
        throw error;
      });
  }

  logout(): Promise<void> {
    return signOut(this.auth)
      .then(() => {
        console.log('User logged out successfully');
      })
      .catch((error) => {
        console.error('Logout error:', error);
        throw error;
      });
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }
}
