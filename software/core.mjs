// Platform-independent behavior prototype. All approval decisions are simulated.
export class Orbit {
  constructor(now = 0) {
    this.now = now;
    this.state = 'sleeping';
    this.mode = 'companion';
    this.orientation = 'portrait';
    this.candidate = null;
    this.candidateSince = now;
    this.orientationLocked = false;
    this.security = 'off';
    this.locked = false;
    this.lastTouch = now;
    this.lastPickup = -Infinity;
    this.pickupRemarks = true;
    this.quiet = false;
    this.connected = true;
    this.requests = [];
    this.seen = new Set();
    this.events = [];
    this.decisions = [];
    this.approvalGrant = null;
    this.conversation = 0;
    this.line = '';
    this.focusUntil = null;
  }
  emit(type, data = {}) { this.events.push({ type, at: this.now, ...data }); }
  wake(reason = 'touch') {
    this.state = 'idle';
    this.lastTouch = this.now;
    this.line = ''; // Idle and sleeping character screens stay free of stale dialogue.
    this.emit('wake', { reason });
  }
  pickup() {
    const sleeping = this.state === 'sleeping';
    if (sleeping) this.wake('pickup');
    if (sleeping && this.now - this.lastPickup >= 60000) {
      if (this.pickupRemarks && !this.quiet) this.emit('pickup-remark');
      this.lastPickup = this.now;
    }
  }
  sleep() {
    this.state = 'sleeping';
    this.line = '';
    this.conversation++;
    this.approvalGrant = null;
    if (this.security !== 'off') this.locked = true;
    this.emit('sleep');
  }
  touch() { if (this.state === 'sleeping') this.wake(); this.lastTouch = this.now; }
  setSecurity(policy) {
    if (!['off', 'idle', 'approval'].includes(policy)) throw new Error('Unknown lock policy');
    this.security = policy;
    this.locked = policy !== 'off';
    this.approvalGrant = null;
  }
  unlock(verified, requestId = null) {
    if (!verified) return false;
    this.locked = false;
    this.lastTouch = this.now;
    this.approvalGrant = requestId ? { id: requestId, expires: this.now + 15000 } : null;
    return true;
  }
  sampleOrientation(value) {
    if (this.orientationLocked || value === 'flat') { this.candidate = null; return; }
    if (!['portrait', 'landscape'].includes(value)) return;
    if (this.candidate !== value) { this.candidate = value; this.candidateSince = this.now; }
    if (this.now - this.candidateSince >= 650 && this.orientation !== value) {
      this.orientation = value;
      this.emit('orientation', { value });
    }
  }
  receive(request) {
    if (!request.id || this.seen.has(request.id) || request.expires <= this.now) return false;
    this.seen.add(request.id);
    this.requests.push({ ...request, snoozedUntil: 0 });
    if (this.state === 'sleeping') this.wake('alert');
    this.emit('alert', { audible: !this.quiet });
    return true;
  }
  get active() { return this.requests.find(r => r.expires > this.now && r.snoozedUntil <= this.now); }
  get visibleRequest() { return this.locked ? null : this.active; }
  decide(id, decision) {
    const request = this.active;
    if (!request || request.id !== id || !['approve', 'reject'].includes(decision)) return 'unavailable';
    if (!this.connected) return 'offline';
    if (this.locked || (this.security === 'approval' &&
      (!this.approvalGrant || this.approvalGrant.id !== id || this.approvalGrant.expires <= this.now))) return 'passcode';
    this.requests = this.requests.filter(r => r.id !== id);
    this.approvalGrant = null;
    this.decisions.push({ id, decision, at: this.now });
    this.emit('demo-decision', { id, decision });
    this.line = decision === 'approve' ? 'Sample request approved.' : 'Sample request declined.';
    this.lastTouch = this.now;
    return 'ok';
  }
  snooze(id) {
    if (this.locked || this.active?.id !== id) return false;
    this.active.snoozedUntil = this.now + 60000;
    this.approvalGrant = null;
    this.emit('snooze');
    return true;
  }
  listen() {
    this.touch();
    if (this.locked) return null;
    if (!this.connected) { this.line = 'Waiting for the connection.'; return null; }
    this.state = 'listening';
    this.line = 'Listening…';
    return ++this.conversation;
  }
  advanceVoice(token, state) {
    if (token !== this.conversation || this.locked || !this.connected || this.state === 'sleeping') return false;
    this.state = state;
    this.line = { thinking: 'Let me check that…', speaking: 'I’m right here. Let’s keep going.', idle: 'Ready when you are.' }[state];
    return true;
  }
  setConnected(value) {
    this.connected = value;
    if (!value) { this.conversation++; if (this.state !== 'sleeping') this.state = 'idle'; }
    this.approvalGrant = null;
  }
  tick(now) {
    this.now = now;
    for (const r of this.requests) {
      if (r.snoozedUntil && r.snoozedUntil <= now && r.expires > now) {
        r.snoozedUntil = 0;
        if (this.state === 'sleeping') this.wake('alert');
        this.emit('alert', { audible: !this.quiet });
      }
    }
    this.requests = this.requests.filter(r => r.expires > now);
    if (this.approvalGrant && this.approvalGrant.expires <= now) this.approvalGrant = null;
    if (this.security !== 'off' && now - this.lastTouch >= 30000) {
      this.locked = true;
      this.approvalGrant = null;
      this.conversation++;
      if (this.state !== 'sleeping') this.state = 'idle';
    }
    if (this.focusUntil && now >= this.focusUntil) {
      this.focusUntil = null;
      this.emit('focus-complete', { audible: !this.quiet });
    }
    if (!this.active && this.state === 'idle' && now - this.lastTouch >= 90000) this.sleep();
  }
}
