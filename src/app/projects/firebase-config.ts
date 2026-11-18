/**
 * The Firebase project the app keeps signed-in users' projects in (the one
 * that hosts it). None of this is secret: what a user may read and write is
 * set by the database's rules (`database.rules.json`).
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAi3UUlTo83G8ex4bPEyAcOrY7Q-X7ntgc',
  authDomain: 'cnc-utils.firebaseapp.com',
  databaseURL:
    'https://cnc-utils-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'cnc-utils',
};
