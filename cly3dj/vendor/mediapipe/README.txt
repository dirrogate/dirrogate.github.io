MediaPipe for the Dirrogram person cutout (CLAUDE.md #428).
- vision_bundle.mjs + wasm/: @mediapipe/tasks-vision 1.0.1 (Apache-2.0, Google), unmodified except the source-map line removed.
- selfie_segmentation.tflite: the model from @mediapipe/selfie_segmentation 0.1.1675465747 (Apache-2.0, Google) with TFLite
  metadata added (tflite-support 0.4.4 ImageSegmenter writer: input normalisation mean 0, std 255; one label, person),
  which the Tasks ImageSegmenter needs. Weights unchanged.

- face_landmarker.task: the MediaPipe Face Landmarker model (float16, version 1, Apache-2.0, Google), 3,758,596 bytes, sha256 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff (the Git LFS object of the official file). Used by js/drostemaker.js (#705, MOUTH).
