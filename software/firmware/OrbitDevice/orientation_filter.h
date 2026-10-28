#pragma once
#include <stdint.h>

// Sensor-independent decision logic. An adapter must supply measured gravity
// in g, calibrated to the enclosure axes. This does not detect hardware or
// change the display. Do not feed simulated values into production firmware.
namespace orbit {
enum class Posture : uint8_t { Landscape, Portrait, LandscapeInverted, PortraitInverted };

class OrientationFilter {
 public:
  constexpr explicit OrientationFilter(Posture initial = Posture::Landscape)
      : current_(initial), candidate_(initial) {}
  constexpr Posture current() const { return current_; }
  constexpr void setLocked(bool locked) { locked_ = locked; pending_ = false; }

  // True only on a stable change. Unsigned subtraction tolerates millis wrap.
  // Sample regularly (e.g. 50 ms). A missing sensor cannot complete a change.
  constexpr bool sample(float x, float y, float z, uint32_t now) {
    if (hasSample_ && uint32_t(now - lastSample_) > 250) pending_ = false;
    hasSample_ = true;
    lastSample_ = now;
    const float norm2 = x*x + y*y + z*z;
    if (locked_ || !(norm2 >= 0.5625f && norm2 <= 1.5625f)
        || abs(z) > 0.82f) { pending_ = false; return false; }
    const float ax = abs(x), ay = abs(y);
    Posture next = current_;
    // Axis meanings are an adapter contract, not an assumed sensor mounting.
    if (ay >= 0.65f && ay - ax >= 0.20f)
      next = y > 0 ? Posture::Landscape : Posture::LandscapeInverted;
    else if (ax >= 0.65f && ax - ay >= 0.20f)
      next = x > 0 ? Posture::Portrait : Posture::PortraitInverted;
    else { pending_ = false; return false; }
    if (next == current_) { pending_ = false; return false; }
    if (!pending_ || next != candidate_) {
      candidate_ = next; since_ = now; pending_ = true; return false;
    }
    if (uint32_t(now - since_) < 650) return false;
    current_ = next;
    pending_ = false;
    return true;
  }

 private:
  static constexpr float abs(float value) { return value < 0 ? -value : value; }
  Posture current_, candidate_;
  uint32_t since_ = 0, lastSample_ = 0;
  bool pending_ = false, locked_ = false, hasSample_ = false;
};
}  // namespace orbit
