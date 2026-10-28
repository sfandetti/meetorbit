# Orbit visual systems

The Corporate layout is the original preview. Its original HTML, CSS and app logic were saved unchanged in `corporate-baseline/` before adding theme infrastructure. Every theme now sits inside Seth's supplied enclosure renders. The original transparent landscape (2400 × 1500) and portrait (1500 × 2400) images are copied unmodified into `assets/`. The interface is a live overlay, not an edited screenshot. The blue LED illumination follows the end bands in those images. Screen close-up temporarily hides the enclosure for easier touch/layout review on narrow browser windows.

| Theme | Composition and character | Instruments and clock | Motion |
| --- | --- | --- | --- |
| Corporate | Original split desk layout, simple glowing eyes, restrained sans-serif text | Linear meters, clean digital clock | Original blinking eyes and speaking mouth |
| Arcade | Pixel robot, gridded game HUD, hard-edged actions, console typography | Circular energy dials, segmented-style clock, spectrum strip | Floating pixels, animated dials, pixel mouth |
| Flight Deck | Radar companion, calibrated instrument grid, mission-style requests, monospace readouts | Needle gauges, analog instrument clock | Radar sweep, needle settling |
| Pocket Pal | Large soft creature, sticker panels, pill controls, rounded lettering | Bubble meters, characterful alarm-clock dial | Gentle creature bounce and facial expressions |
| Field Notes | Line-drawn companion, ruled paper, serif hierarchy, editorial requests | Ruled readings, ink-style analog clock | Restrained clock movement, no decorative bounce |

## Research references

- [LVGL interactive demos](https://lvgl.io/demos): examples include a 320 × 240 thermostat rendered without images, instrument widgets and an animated music spectrum. Informed the distinct instrument vocabulary and implementation feasibility; no assets copied.
- [Designing for Playdate](https://help.play.date/developer/designing-for-playdate/): small-display readability, legible sprites and accessibility. Informed the pixel and ink treatments rather than changing only colors. Orbit is not a Playdate emulator.
- [Teenage Engineering OP–1 field](https://teenage.engineering/products/op-1): screen-by-screen graphic treatments, meters and instrument-like interaction. Informed the Flight Deck direction; no branded interface or artwork copied.

These references informed original designs. They do not establish measured rendering performance on Orbit's actual CYD board.

## Shared behavior

Theme selection persists in this browser; it does not change PIN settings, pending requests or screen-review choices. Every theme uses the same request/lock state machine. Hidden private details stay out of the visual theme canvas while locked. The original 21-screen catalog remains available in every theme.

The character, clocks and telemetry panels are redesigned, alongside action shapes, typography and spacing. Existing remote/media/camera screens inherit each visual system, but their controls are still sample interactions. This is not a finished firmware theme engine.

## Blue rings

Steady at idle; dim while sleeping; breathe while listening; alternate while thinking; pulse when a request needs attention. The hue stays blue in every theme. Brightness and off controls are available. Off removes the light overlay; the image's blue plastic bands remain visible. Turning off animation or enabling OS reduced motion stops the animation. Quiet mode suppresses audio, not visual notification. The browser representation does not prove real LED control: actual LED type, current, pins and driver must be established from the hardware.

## Next hardware pass

Map drawing routines to the actual graphics stack and test frame time, available memory and touch layout on the ESP32-2432S028R. Verify an external motion-sensor plan; do not assume this CYD has the earlier Waveshare board's IMU. Supplied renders establish the visual case shape and LED placement, not measured CAD dimensions or fit.
