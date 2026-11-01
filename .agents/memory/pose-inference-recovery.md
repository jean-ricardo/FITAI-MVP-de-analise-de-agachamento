---
name: Pose inference recovery
description: Recovery behavior for browser-based MediaPipe pose detection.
---

MediaPipe GPU can initialize successfully and still throw during `detectForVideo`. GPU-to-CPU fallback must cover runtime inference errors, not only model initialization; a thrown frame must not terminate the requestAnimationFrame loop.

**Why:** FITAI's landmarks stopped appearing on some camera/browser setups even though MediaPipe and its public model/WASM resources loaded successfully.

**How to apply:** When changing the FITAI camera pipeline, preserve runtime exception handling, delegate fallback, and diagnostics that distinguish no detected poses from inference errors.

For squat phase transitions, use the current pose angle; keep smoothed landmarks for reported metrics. Smoothing can delay threshold crossings during a quick ascent.

**Why:** A simulated ascent with no pause at the top did not finish a repetition when transitions depended only on smoothed points.

**How to apply:** Include a synthetic quick-ascent sequence in tracker checks, along with at least one brief loss-of-tracking case.
