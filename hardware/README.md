# Capsule v1 hardware and parts

This is the parts list for the tabletop **Capsule v1 prototype** shown on the MeetOrbit site. The separate board, microphone, amplifier, speaker, power board, batteries, lights, connectors and fasteners are listed below. Search terms are provided so builders can look up the components independently.

**Prototype direction:** Orbit is a working prototype and it is fun to use. We intend to optimize the design, reduce its size, develop a dedicated circuit board (PCB) to simplify the wiring and assembly, and eventually offer an assembled product for sale. That board and smaller version are planned development work, not included finished designs or products available to buy today.

[Download the parts spreadsheet](CAPSULE-PARTS.csv) · [Illustrated build guide](Build_guide/Orbit_Build_Guide.html) · [Wiring guide](Build_guide/Orbit_Harness_Wiring.html)

| Quantity | Separate component | Part / useful search term | Fit and verification |
| --- | --- | --- | --- |
| 1 | Display / controller board | ESP32-2432S028R (CYD) — ESP32-2432S028R CYD 2.8 resistive touchscreen | 2.8-inch resistive touch; ESP32; match the board revision and connector arrangement |
| 1 | Microphone module | INMP441 — INMP441 I2S microphone module | I2S digital microphone breakout; VDD at 3.3 V per build guide |
| 1 | Audio amplifier module | MAX98357A — MAX98357A I2S amplifier breakout | I2S amplifier breakout; separate from microphone and speaker |
| 1 | Speaker driver | **Dayton Audio PC68-4**, 2.5-inch full-range, 4 ohm — [exact Amazon item](https://www.amazon.com/dp/B0751FW9NP) | Manufacturer rating: 20 W RMS / 40 W max; frame 68 mm, depth 37 mm, cutout 64 mm. This is the driver rating, not Orbit amplifier output. |
| 1 | USB-C battery charger / 5 V boost board | Cermant charge/boost module — Cermant Type C 5V 2A charger boost B0GRV7F1LJ | Capsule guide identifies Cermant. Earlier hardware list references Amazon ASIN B0GRV7F1LJ; exact Capsule purchase match needs confirmation. |
| 1 | Battery holder | Dual 18650 parallel holder — 2 x 18650 parallel battery holder | Measured external envelope 78 x 40 x 22 mm; match wiring and clearances |
| 2 | Battery cells | 18650 Li-ion — 18650 matched Li-ion cells | Matched cells; prototype guide uses a 1S parallel arrangement, never series into a 1S charger |
| 8 LEDs total | Lighting | WS2812 addressable LEDs — WS2812 4 LED strip segment | Two chained 4-LED pieces; match current firmware pin map |
| 1 | LED data resistor | 330 ohm — 330 ohm resistor | Series data resistor from build guide |
| 1 | Power button | 6 x 6 mm momentary tactile switch — 6x6mm tactile push button | Connect to charge/boost board power-key input according to wiring guide |
| 3 | Board signal cables | JST 1.25 mm 4-pin pigtails — JST 1.25mm 4 pin connector with wire | For P1 / CN1 / P3; verify connector fit and wire order; not JST GH |
| 1 | Programming cable | USB data cable matching CYD board port — USB data cable for ESP32 CYD board | Must support data, not charge-only |
| 8 | Heat-set inserts | M3 x 5 x 4 — M3 5mm length 4mm OD heat set insert | Match insert dimensions to the Capsule revision |
| 8 | Assembly screws | M3 x 6 mm — M3x6 screw | Four screen mounts and four speaker mounts per guide |
| As needed | Wiring and assembly supplies | Hook-up wire, heat-shrink, solder, two small zip ties, adhesive — silicone hook up wire heat shrink solder | Wire gauge and fastening must suit the actual power path and revision |
| 1 set | Printed enclosure | Capsule v1 STL and 3MF set — See repository hardware/STL/Capsule_v1 and hardware/Print | Tube, lids, collars, sled, spacer, screen posts and button plungers; keep fit-test alternatives identified |

## Exact-build gaps to finish

The speaker is now identified from Seth's exact purchase link as the Dayton Audio PC68-4 (Amazon model PC68-4-S), ASIN B0751FW9NP. [Manufacturer specifications](https://daytonaudio.com/product/1538/pc68-4-2-1-2-full-range-poly-cone-driver) confirm 4 ohm impedance and the ratings above. CAD retains the physical measurements of the actual prototype. The exact Capsule charge/boost board purchase should also be confirmed against the older ASIN reference. We have not invented missing specifications or treated a visually similar part as identical.

## Revisions and source files

- `STL/Capsule_v1/` and `Print/*Capsule*.3mf`: actual Capsule prototype print files, including alternatives and fit tests.
- `CAD/`: parametric scripts and render helpers; external toolchain requirements are in `../docs/SETUP.md`.
- `Build_guide/`: Capsule assembly and harness references.
- Older Halo/reference design records are kept outside this public Capsule package. Use this Capsule parts list for the design shown here.

Do not mix a historical wiring diagram, enclosure or BOM with a different board revision. Follow the matched guide for the 1S parallel battery arrangement and battery precautions.

## License

Original Capsule hardware and build documentation: [CERN-OHL-P-2.0](LICENSE). See [NOTICE.md](NOTICE.md).
