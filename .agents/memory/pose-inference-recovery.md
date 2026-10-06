---
name: Pose inference recovery
description: Recovery behavior for browser-based MediaPipe pose detection.
---

MediaPipe GPU can initialize successfully and still throw during `detectForVideo`. GPU-to-CPU fallback must cover runtime inference errors, not only model initialization; a thrown frame must not terminate the requestAnimationFrame loop.

**Why:** FITAI's landmarks stopped appearing on some camera/browser setups even though MediaPipe and its public model/WASM resources loaded successfully.

**How to apply:** When changing the FITAI camera pipeline, preserve runtime exception handling, delegate fallback, and diagnostics that distinguish no detected poses from inference errors.
