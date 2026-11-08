import '@testing-library/jest-dom';

// Polyfill window.HTMLMediaElement.prototype.play and load if needed
if (typeof window !== 'undefined') {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  if (typeof (window as any).MediaStream === 'undefined') {
    (window as any).MediaStream = class MediaStream {
      tracks: any[] = [];
      constructor(tracks: any[] = []) {
        this.tracks = tracks;
      }
      getAudioTracks() {
        return this.tracks.filter((t: any) => t.kind === 'audio');
      }
      getVideoTracks() {
        return this.tracks.filter((t: any) => t.kind === 'video');
      }
      getTracks() {
        return this.tracks;
      }
    };
  }
}

// Polyfill HTMLDialogElement for jsdom testing
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
