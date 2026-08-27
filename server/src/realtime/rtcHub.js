class RTCHub {
  constructor(io) {
    this.io = io;
  }

  broadcast(event, payload) {
    // Clients forward rtc-relay messages over their WebRTC data channels to keep peers in sync.
    this.io.emit("rtc-relay", { event, payload, ts: Date.now() });
  }
}

export default RTCHub;
