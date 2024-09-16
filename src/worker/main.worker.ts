/// <reference lib="webworker" />

import { Observable } from 'rxjs';

new Observable((observer) => {
  observer.next('worker response from observable');
  observer.complete();
}).subscribe((v) => postMessage(v));

addEventListener('message', ({ data }) => {
  const response = `worker response to ${data}`;
  postMessage(response);
});

/*

  const worker = new Worker(new URL('./main.worker', import.meta.url));
  worker.onmessage = ({ data }) => {
    console.log(`page got message: ${data}`);
  };
  worker.postMessage('hello');

*/
